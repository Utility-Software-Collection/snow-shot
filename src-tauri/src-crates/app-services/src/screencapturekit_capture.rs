use screencapturekit::{
    cm_sample_buffer::CMSampleBuffer,
    sc_content_filter::{InitParams, SCContentFilter},
    sc_error_handler::StreamErrorHandler,
    sc_output_handler::{SCStreamOutputType, StreamOutput},
    sc_shareable_content::SCShareableContent,
    sc_stream::SCStream,
    sc_stream_configuration::SCStreamConfiguration,
};
use std::{
    ffi::CString,
    fs::{self, File},
    io::{self, Write},
    os::fd::FromRawFd,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

const SAMPLE_RATE: u32 = 48_000;
const CHANNEL_COUNT: u32 = 2;

pub struct MacSystemAudioPipe {
    pub path: PathBuf,
}

struct AudioErrorHandler;

impl StreamErrorHandler for AudioErrorHandler {
    fn on_error(&self) {
        log::error!("ScreenCaptureKit system audio stream reported an error");
    }
}

struct AudioOutput {
    sender: Sender<Vec<u8>>,
}

impl StreamOutput for AudioOutput {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Audio) {
            return;
        }

        let mut pcm = Vec::new();
        for buffer in sample.sys_ref.get_av_audio_buffer_list() {
            pcm.extend_from_slice(&buffer.data);
        }

        if !pcm.is_empty() {
            let _ = self.sender.send(pcm);
        }
    }
}

pub struct MacSystemAudioCapture {
    stream: SCStream,
    sender: Option<Sender<Vec<u8>>>,
    stop_requested: Arc<AtomicBool>,
    writer_thread: Option<JoinHandle<()>>,
    pipe_path: PathBuf,
}

impl MacSystemAudioCapture {
    pub fn create_pipe() -> io::Result<MacSystemAudioPipe> {
        let pipe_path = std::env::temp_dir().join(format!(
            "snow-shot-system-audio-{}-{}.fifo",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default()
        ));
        let pipe_path_string = pipe_path.to_string_lossy().into_owned();
        let pipe_path_c = CString::new(pipe_path_string).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("Invalid system audio pipe path: {error}"),
            )
        })?;

        let result = unsafe { libc::mkfifo(pipe_path_c.as_ptr(), 0o600) };
        if result != 0 {
            return Err(io::Error::last_os_error());
        }

        Ok(MacSystemAudioPipe { path: pipe_path })
    }

    pub fn start(pipe: MacSystemAudioPipe, display_id: u32) -> io::Result<Self> {
        let result = Self::start_inner(&pipe.path, display_id);
        if result.is_err() {
            let _ = fs::remove_file(&pipe.path);
        }
        result
    }

    fn start_inner(pipe_path: &Path, display_id: u32) -> io::Result<Self> {
        let content = SCShareableContent::try_current().map_err(io_other)?;
        let display = content
            .displays
            .into_iter()
            .find(|display| display.display_id == display_id)
            .or_else(|| {
                log::warn!(
                    "Display {display_id} was not found in ScreenCaptureKit content; using the first display"
                );
                SCShareableContent::try_current()
                    .ok()
                    .and_then(|content| content.displays.into_iter().next())
            })
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "No macOS display found"))?;

        let filter = SCContentFilter::new(InitParams::Display(display.clone()));
        let configuration = SCStreamConfiguration {
            width: display.width,
            height: display.height,
            captures_audio: true,
            sample_rate: SAMPLE_RATE,
            channel_count: CHANNEL_COUNT,
            excludes_current_process_audio: true,
            ..Default::default()
        };

        let (sender, receiver) = mpsc::channel();
        let stop_requested = Arc::new(AtomicBool::new(false));
        let writer_stop_requested = Arc::clone(&stop_requested);
        let pipe_path_for_writer = pipe_path.to_path_buf();
        let writer_thread = thread::Builder::new()
            .name("snow-shot-system-audio".to_string())
            .spawn(move || write_audio_pipe(pipe_path_for_writer, receiver, writer_stop_requested))
            .map_err(|error| io_other(error.to_string()))?;

        let mut stream = SCStream::new(filter, configuration, AudioErrorHandler);
        stream.add_output(
            AudioOutput {
                sender: sender.clone(),
            },
            SCStreamOutputType::Audio,
        );

        if let Err(error) = stream.start_capture() {
            stop_requested.store(true, Ordering::Release);
            drop(sender);
            let _ = writer_thread.join();
            return Err(io_other(format!(
                "Failed to start ScreenCaptureKit audio: {error}"
            )));
        }

        Ok(Self {
            stream,
            sender: Some(sender),
            stop_requested,
            writer_thread: Some(writer_thread),
            pipe_path: pipe_path.to_path_buf(),
        })
    }

    pub fn stop(&mut self) {
        self.stop_requested.store(true, Ordering::Release);
        let _ = self.stream.stop_capture();
        self.sender.take();
        let _ = fs::remove_file(&self.pipe_path);
        if let Some(writer_thread) = self.writer_thread.take() {
            let _ = writer_thread.join();
        }
    }
}

impl Drop for MacSystemAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

fn write_audio_pipe(
    pipe_path: PathBuf,
    receiver: Receiver<Vec<u8>>,
    stop_requested: Arc<AtomicBool>,
) {
    let pipe_path_c = match CString::new(pipe_path.to_string_lossy().into_owned()) {
        Ok(path) => path,
        Err(error) => {
            log::error!("Invalid system audio pipe path: {error}");
            return;
        }
    };

    let mut pipe = loop {
        if stop_requested.load(Ordering::Acquire) {
            return;
        }

        let fd = unsafe { libc::open(pipe_path_c.as_ptr(), libc::O_WRONLY | libc::O_NONBLOCK) };
        if fd >= 0 {
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags >= 0 {
                unsafe {
                    libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK);
                }
            }
            break unsafe { File::from_raw_fd(fd) };
        }

        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(libc::ENOENT) | Some(libc::ENXIO) => thread::sleep(Duration::from_millis(10)),
            _ => {
                log::error!("Failed to open ScreenCaptureKit audio pipe: {error}");
                return;
            }
        }
    };

    while !stop_requested.load(Ordering::Acquire) {
        let Ok(pcm) = receiver.recv_timeout(Duration::from_millis(100)) else {
            continue;
        };

        if let Err(error) = pipe.write_all(&pcm) {
            if error.kind() != io::ErrorKind::BrokenPipe {
                log::warn!("Failed to write ScreenCaptureKit audio: {error}");
            }
            return;
        }
    }
}

fn io_other(error: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::Other, error.to_string())
}
