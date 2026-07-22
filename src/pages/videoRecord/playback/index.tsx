import {
	CloseOutlined,
	CopyOutlined,
	PauseOutlined,
	PlayCircleFilled,
	RedoOutlined,
	SaveOutlined,
} from "@ant-design/icons";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button, Flex, Select, Slider, Tooltip, theme } from "antd";
import { useCallback, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import clipboard from "tauri-plugin-clipboard-api";
import { videoRecordExport } from "@/commands/videoRecord";

type PlaybackFormat = "mp4" | "gif" | "webp";

const formatTime = (seconds: number) => {
	const value = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(value / 60)
		.toString()
		.padStart(2, "0");
	const remainder = (value % 60).toString().padStart(2, "0");
	return `${minutes}:${remainder}`;
};

export const VideoRecordPlayback: React.FC<{
	filePath: string;
	onClose: () => void;
	onRecordAgain: () => void;
}> = ({ filePath, onClose, onRecordAgain }) => {
	const { token } = theme.useToken();
	const intl = useIntl();
	const videoRef = useRef<HTMLVideoElement>(null);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [range, setRange] = useState<[number, number]>([0, 0]);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeed] = useState(1);
	const [volume, setVolume] = useState(100);
	const [format, setFormat] = useState<PlaybackFormat>("mp4");
	const [exporting, setExporting] = useState(false);

	const videoSource = useMemo(() => convertFileSrc(filePath), [filePath]);
	const trimEnd = range[1] || duration;

	const seek = useCallback((time: number) => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		video.currentTime = time;
		setCurrentTime(time);
	}, []);

	const setVideoVolume = useCallback((nextVolume: number) => {
		const normalizedVolume = Math.min(100, Math.max(0, nextVolume));
		setVolume(normalizedVolume);
		if (videoRef.current) {
			videoRef.current.volume = normalizedVolume / 100;
			videoRef.current.muted = false;
		}
	}, []);

	const exportClip = useCallback(
		async (copyAfterExport: boolean) => {
			if (trimEnd <= range[0]) {
				return;
			}
			setExporting(true);
			try {
				const outputFile = `${filePath}.trim.${format}`;
				const exportedFile = await videoRecordExport(
					filePath,
					outputFile,
					range[0],
					trimEnd,
					format,
				);
				if (copyAfterExport) {
					await clipboard.writeFiles([exportedFile]);
				}
			} finally {
				setExporting(false);
			}
		},
		[filePath, format, range, trimEnd],
	);

	return (
		<div className="playback" onContextMenu={(event) => event.preventDefault()}>
			<div data-tauri-drag-region className="playback-header">
				<div className="playback-title">
					<span>{intl.formatMessage({ id: "videoRecord.playback" })}</span>
					<span className="playback-duration">
						{formatTime(Math.max(0, trimEnd - range[0]))}
					</span>
				</div>
				<Flex align="center" gap={token.paddingXS}>
					<Select
						size="small"
						value={format}
						options={[
							{ label: "MP4", value: "mp4" },
							{ label: "GIF", value: "gif" },
							{ label: "WEBP", value: "webp" },
						]}
						onChange={setFormat}
					/>
					<Tooltip
						title={intl.formatMessage({ id: "videoRecord.recordAgain" })}
					>
						<Button
							icon={<RedoOutlined />}
							onClick={onRecordAgain}
							type="text"
						/>
					</Tooltip>
					<Tooltip
						title={intl.formatMessage({ id: "videoRecord.closePlayback" })}
					>
						<Button icon={<CloseOutlined />} onClick={onClose} type="text" />
					</Tooltip>
				</Flex>
			</div>

			<div className="playback-stage">
				{/* biome-ignore lint/a11y/useMediaCaption: Captions are unavailable for newly recorded local files. */}
				<video
					ref={videoRef}
					src={videoSource}
					onLoadedMetadata={(event) => {
						const nextDuration = event.currentTarget.duration;
						setDuration(nextDuration);
						setRange([0, nextDuration]);
					}}
					onTimeUpdate={(event) => {
						const nextTime = event.currentTarget.currentTime;
						if (nextTime >= trimEnd) {
							event.currentTarget.pause();
							setPlaying(false);
							seek(range[0]);
							return;
						}
						setCurrentTime(nextTime);
					}}
					onPlay={() => setPlaying(true)}
					onPause={() => setPlaying(false)}
					className="playback-video"
				/>
			</div>

			<div className="playback-timeline">
				<div className="timeline-label">
					<span>
						{intl.formatMessage({ id: "videoRecord.playbackProgress" })}
					</span>
					<span>{`${formatTime(currentTime)} / ${formatTime(duration)}`}</span>
				</div>
				<Slider
					min={0}
					max={duration || 1}
					value={currentTime}
					onChange={seek}
					tooltip={{ formatter: formatTime }}
				/>
				<div className="timeline-label trim-label">
					<span>{intl.formatMessage({ id: "videoRecord.keepRange" })}</span>
					<span>{`${formatTime(range[0])} - ${formatTime(trimEnd)}`}</span>
				</div>
				<Slider
					range
					min={0}
					max={duration || 1}
					value={[range[0], trimEnd]}
					onChange={(value) => {
						if (Array.isArray(value)) {
							setRange([value[0], value[1]]);
							seek(Math.max(value[0], Math.min(currentTime, value[1])));
						}
					}}
					tooltip={{ formatter: formatTime }}
				/>
				<Flex
					align="center"
					aria-label={intl.formatMessage({ id: "videoRecord.volume" })}
					className="playback-volume"
					gap={token.paddingSM}
				>
					<input
						aria-valuetext={`${volume}%`}
						className="volume-slider"
						min={0}
						max={100}
						onChange={(event) => setVideoVolume(Number(event.target.value))}
						style={{
							backgroundImage: `linear-gradient(to right, ${token.colorPrimary} 0%, ${token.colorPrimary} ${volume}%, ${token.colorBorderSecondary} ${volume}%, ${token.colorBorderSecondary} 100%)`,
						}}
						type="range"
						value={volume}
					/>
					<span className="volume-value">{volume}%</span>
				</Flex>
			</div>

			<div className="playback-footer">
				<Flex align="center" gap={token.paddingSM}>
					<Tooltip
						title={intl.formatMessage({
							id: playing ? "videoRecord.pause" : "videoRecord.play",
						})}
					>
						<Button
							className="playback-play-button"
							icon={playing ? <PauseOutlined /> : <PlayCircleFilled />}
							onClick={() => {
								const video = videoRef.current;
								if (!video) return;
								if (video.paused) {
									if (
										video.currentTime < range[0] ||
										video.currentTime >= trimEnd
									) {
										seek(range[0]);
									}
									void video.play();
								} else {
									video.pause();
								}
							}}
							type="primary"
						/>
					</Tooltip>
					<Select
						size="small"
						value={speed}
						options={[0.5, 1, 1.5, 2].map((value) => ({
							label: `${value}x`,
							value,
						}))}
						onChange={(value) => {
							setSpeed(value);
							if (videoRef.current) videoRef.current.playbackRate = value;
						}}
					/>
				</Flex>
				<Flex align="center" gap={token.paddingXS}>
					<Tooltip title={intl.formatMessage({ id: "videoRecord.copyExport" })}>
						<Button
							icon={<CopyOutlined />}
							loading={exporting}
							onClick={() => void exportClip(true)}
							type="text"
						/>
					</Tooltip>
					<Button
						icon={<SaveOutlined />}
						loading={exporting}
						onClick={() => void exportClip(false)}
					>
						{intl.formatMessage({ id: "videoRecord.saveExport" })}
					</Button>
				</Flex>
			</div>

			<style jsx>{`
				.playback { width: 860px; box-sizing: border-box; overflow: hidden; background: ${token.colorBgContainer}; border: 1px solid ${token.colorBorderSecondary}; box-shadow: ${token.boxShadowSecondary}; }
				.playback-header { height: 48px; padding: 0 ${token.paddingLG}px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid ${token.colorBorderSecondary}; cursor: move; user-select: none; }
				.playback-title { display: flex; align-items: center; gap: ${token.paddingSM}px; font-size: ${token.fontSizeLG}px; font-weight: ${token.fontWeightStrong}; color: ${token.colorText}; }
				.playback-duration { padding: 2px ${token.paddingXS}px; border-radius: ${token.borderRadiusSM}px; background: ${token.colorFillQuaternary}; color: ${token.colorTextSecondary}; font-size: ${token.fontSizeSM}px; font-weight: ${token.fontWeight}; font-variant-numeric: tabular-nums; }
				.playback-stage { height: 410px; display: flex; align-items: center; justify-content: center; background: #171717; }
				.playback-video { display: block; width: 100%; height: 100%; object-fit: contain; }
				.playback-timeline { padding: ${token.paddingSM}px ${token.paddingLG}px ${token.paddingXXS}px; border-bottom: 1px solid ${token.colorBorderSecondary}; }
				.timeline-label { display: flex; justify-content: space-between; color: ${token.colorTextSecondary}; font-size: ${token.fontSizeSM}px; font-variant-numeric: tabular-nums; }
				.trim-label { margin-top: ${token.marginXXS}px; color: ${token.colorText}; }
				.playback-timeline :global(.ant-slider) { margin: ${token.marginXXS}px 0 ${token.marginSM}px; }
				.playback-footer { min-height: 56px; padding: 0 ${token.paddingLG}px; display: flex; align-items: center; justify-content: space-between; }
				.playback-play-button { width: 32px; height: 32px; }
				.playback-volume { width: 100%; min-height: 32px; padding: 0; margin: ${token.marginXS}px 0 ${token.marginXXS}px; color: ${token.colorTextSecondary}; box-sizing: border-box; }
				.volume-slider { appearance: none; -webkit-appearance: none; flex: 1; min-width: 0; height: 30px; margin: 0; background-color: transparent; background-position: center; background-repeat: no-repeat; background-size: 100% 2px; cursor: pointer; }
				.volume-slider::-webkit-slider-runnable-track { height: 2px; background: transparent; }
				.volume-slider::-webkit-slider-thumb { width: 8px; height: 30px; margin-top: -14px; appearance: none; -webkit-appearance: none; border: 0; border-radius: 4px; background: ${token.colorPrimary}; box-shadow: none; }
				.volume-slider:focus-visible { outline: none; }
				.volume-slider:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px ${token.colorPrimaryBg}; }
				.volume-value { width: 40px; color: ${token.colorText}; font-size: ${token.fontSizeLG}px; font-variant-numeric: tabular-nums; text-align: right; }
            `}</style>
		</div>
	);
};
