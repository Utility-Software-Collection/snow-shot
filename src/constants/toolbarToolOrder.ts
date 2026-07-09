import { DrawState } from "@/types/draw";

export const defaultScreenshotToolbarToolOrder: DrawState[] = [
	DrawState.Idle,
	DrawState.Select,
	DrawState.Lock,
	DrawState.Rect,
	DrawState.Ellipse,
	DrawState.Arrow,
	DrawState.Pen,
	DrawState.Text,
	DrawState.SerialNumber,
	DrawState.Blur,
	DrawState.Mosaic,
	DrawState.Eraser,
	DrawState.DrawExtraTools,
	DrawState.Undo,
	DrawState.Redo,
	DrawState.ExtraTools,
	DrawState.Fixed,
	DrawState.OcrDetect,
	DrawState.OcrTranslate,
	DrawState.ScrollScreenshot,
	DrawState.FastSave,
	DrawState.SaveToCloud,
	DrawState.Save,
	DrawState.Cancel,
	DrawState.Copy,
];

export const normalizeToolbarToolOrder = (value: unknown): DrawState[] => {
	const source = Array.isArray(value) ? value : [];
	const validSet = new Set(defaultScreenshotToolbarToolOrder);
	const normalized = source.filter(
		(item): item is DrawState =>
			typeof item === "number" && validSet.has(item as DrawState),
	);

	return [
		...normalized,
		...defaultScreenshotToolbarToolOrder.filter(
			(item) => !normalized.includes(item),
		),
	];
};
