use std::{
    collections::VecDeque,
    ffi::c_void,
    fs::File,
    io::Write,
    os::windows::io::FromRawHandle,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat, initialize_mta};
use windows::{
    Win32::{
        Foundation::{CloseHandle, ERROR_PIPE_CONNECTED, HANDLE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::PIPE_ACCESS_OUTBOUND,
        System::Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
        },
    },
    core::PCWSTR,
};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
const SAMPLE_BITS: u16 = 32;
const CHUNK_FRAMES: usize = 4096;

pub struct WasapiCaptureSession {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl WasapiCaptureSession {
    pub fn close_pipe(pipe_handle: HANDLE) {
        unsafe {
            let _ = CloseHandle(pipe_handle);
        }
    }

    pub fn create_pipe() -> Result<(String, HANDLE), String> {
        let pipe_name = format!(
            r"\\.\pipe\snow-shot-audio-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos()
        );
        let pipe_name_wide: Vec<u16> = pipe_name.encode_utf16().chain(Some(0)).collect();

        let pipe_handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(pipe_name_wide.as_ptr()),
                PIPE_ACCESS_OUTBOUND,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                1024 * 1024,
                1024 * 1024,
                0,
                None,
            )
        };

        if pipe_handle == INVALID_HANDLE_VALUE || pipe_handle.0.is_null() {
            return Err("Failed to create WASAPI audio pipe".to_string());
        }

        Ok((pipe_name, pipe_handle))
    }

    pub fn start(pipe_handle: HANDLE) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = Arc::clone(&stop);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let pipe_handle_value = pipe_handle.0 as usize;
        let mut pending_pipe_handle = Some(pipe_handle);

        let handle = thread::Builder::new()
            .name("snow-shot-wasapi".to_string())
            .spawn(move || {
                let pipe_handle = HANDLE(pipe_handle_value as *mut c_void);
                let result = capture_loop(pipe_handle, stop_thread, ready_tx);
                if let Err(error) = result {
                    log::error!("[WASAPI] capture stopped: {}", error);
                }
            })
            .map_err(|error| {
                unsafe {
                    let _ = CloseHandle(pipe_handle);
                }
                format!("Failed to start WASAPI thread: {}", error)
            })?;

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                pending_pipe_handle.take();
                Ok(Self {
                    stop,
                    handle: Some(handle),
                })
            }
            Ok(Err(error)) => {
                let _ = handle.join();
                Err(error)
            }
            Err(error) => {
                stop.store(true, Ordering::Relaxed);
                if let Some(pipe_handle) = pending_pipe_handle.take() {
                    unsafe {
                        let _ = CloseHandle(pipe_handle);
                    }
                }
                let _ = handle.join();
                Err(format!("WASAPI initialization timed out: {}", error))
            }
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for WasapiCaptureSession {
    fn drop(&mut self) {
        self.stop();
    }
}

fn capture_loop(
    pipe_handle: HANDLE,
    stop: Arc<AtomicBool>,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let connect_result = unsafe { ConnectNamedPipe(pipe_handle, None) };
    if let Err(error) = connect_result
        && error.code().0 as u32 != ERROR_PIPE_CONNECTED.0
    {
        unsafe {
            let _ = CloseHandle(pipe_handle);
        }
        let message = format!("Failed to connect WASAPI audio pipe: {}", error);
        let _ = ready_tx.send(Err(message.clone()));
        return Err(message);
    }

    let mut pipe = unsafe { File::from_raw_handle(pipe_handle.0 as _) };
    let result = capture_audio(&mut pipe, &stop, ready_tx.clone());
    if let Err(error) = &result {
        let _ = ready_tx.send(Err(error.clone()));
    }
    result
}

fn capture_audio(
    pipe: &mut File,
    stop: &AtomicBool,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let com_result = initialize_mta();
    if !com_result.is_ok() {
        return Err(format!("Failed to initialize WASAPI COM: {}", com_result));
    }

    let enumerator = DeviceEnumerator::new()
        .map_err(|error| format!("Failed to enumerate WASAPI devices: {}", error))?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|error| format!("Failed to get default render device: {}", error))?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| format!("Failed to create WASAPI audio client: {}", error))?;

    let desired_format = WaveFormat::new(
        SAMPLE_BITS as usize,
        SAMPLE_BITS as usize,
        &SampleType::Float,
        SAMPLE_RATE as usize,
        CHANNELS as usize,
        None,
    );
    let block_align = desired_format.get_blockalign() as usize;
    let (_, min_period) = audio_client
        .get_device_period()
        .map_err(|error| format!("Failed to get WASAPI device period: {}", error))?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_period,
    };

    audio_client
        .initialize_client(&desired_format, &Direction::Capture, &mode)
        .map_err(|error| format!("Failed to initialize WASAPI client: {}", error))?;
    let event_handle = audio_client
        .set_get_eventhandle()
        .map_err(|error| format!("Failed to create WASAPI event: {}", error))?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|error| format!("Failed to create WASAPI capture client: {}", error))?;
    let mut sample_queue = VecDeque::with_capacity(block_align * CHUNK_FRAMES * 4);

    audio_client
        .start_stream()
        .map_err(|error| format!("Failed to start WASAPI stream: {}", error))?;

    ready_tx
        .send(Ok(()))
        .map_err(|error| format!("Failed to report WASAPI readiness: {}", error))?;

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }

        capture_client
            .read_from_device_to_deque(&mut sample_queue)
            .map_err(|error| format!("Failed to read WASAPI samples: {}", error))?;

        while sample_queue.len() >= block_align * CHUNK_FRAMES {
            let mut chunk = vec![0u8; block_align * CHUNK_FRAMES];
            for byte in &mut chunk {
                *byte = sample_queue.pop_front().unwrap();
            }
            pipe.write_all(&chunk)
                .map_err(|error| format!("Failed to write WASAPI samples: {}", error))?;
        }

        let _ = event_handle.wait_for_event(1000);
    }

    let _ = audio_client.stop_stream();
    pipe.flush()
        .map_err(|error| format!("Failed to flush WASAPI samples: {}", error))?;
    Ok(())
}
