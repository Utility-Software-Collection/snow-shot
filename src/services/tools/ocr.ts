import { fetch } from "@tauri-apps/plugin-http";
import { Base64 } from "js-base64";
import type { ExternalOcrApiConfig } from "@/types/appSettings";
import type {
	OcrDetectResult,
	OcrDetectResultTextBlock,
} from "@/types/commands/ocr";

const toNumber = (value: unknown, fallback: number) =>
	typeof value === "number" && !Number.isNaN(value) ? value : fallback;

const createFullImageTextBlock = (
	text: string,
	width: number,
	height: number,
): OcrDetectResultTextBlock => ({
	box_points: [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
	],
	text,
	text_score: 1,
});

const normalizeTextBlock = (
	block: unknown,
	width: number,
	height: number,
): OcrDetectResultTextBlock | undefined => {
	if (!block || typeof block !== "object") {
		return undefined;
	}

	const data = block as Record<string, unknown>;
	const text = data.text;
	if (typeof text !== "string") {
		return undefined;
	}

	if (!Array.isArray(data.box_points) || data.box_points.length < 4) {
		return createFullImageTextBlock(text, width, height);
	}

	return {
		box_points: data.box_points.slice(0, 4).map((point) => {
			const pointData = point as Record<string, unknown>;
			return {
				x: toNumber(pointData.x, 0),
				y: toNumber(pointData.y, 0),
			};
		}),
		text,
		text_score: toNumber(data.text_score, 1),
	};
};

const findTextBlocks = (
	data: unknown,
	width: number,
	height: number,
): OcrDetectResultTextBlock[] | undefined => {
	if (!data || typeof data !== "object") {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	if (Array.isArray(record.text_blocks)) {
		return record.text_blocks
			.map((block) => normalizeTextBlock(block, width, height))
			.filter((block): block is OcrDetectResultTextBlock => !!block);
	}

	return (
		findTextBlocks(record.data, width, height) ??
		findTextBlocks(record.result, width, height)
	);
};

const findText = (data: unknown): string | undefined => {
	if (typeof data === "string") {
		return data;
	}

	if (!data || typeof data !== "object") {
		return undefined;
	}

	const record = data as Record<string, unknown>;
	for (const key of ["text", "result", "prediction", "output", "message"]) {
		const value = record[key];
		if (typeof value === "string") {
			return value;
		}
	}

	return findText(record.data) ?? findText(record.result);
};

export const externalOcrDetect = async (
	config: ExternalOcrApiConfig,
	imageData: ArrayBuffer,
	params: {
		width: number;
		height: number;
		scaleFactor: number;
	},
): Promise<OcrDetectResult> => {
	const imageBase64 = Base64.fromUint8Array(new Uint8Array(imageData));
	const response = await fetch(config.api_uri, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(config.api_key
				? {
						Authorization: `Bearer ${config.api_key}`,
					}
				: {}),
		},
		body: JSON.stringify({
			image: imageBase64,
			image_base64: imageBase64,
			data_url: `data:image/png;base64,${imageBase64}`,
			mime_type: "image/png",
			width: params.width,
			height: params.height,
		}),
	});

	if (!response.ok) {
		throw new Error(
			`[externalOcrDetect] request failed: ${response.status} ${response.statusText}`,
		);
	}

	const contentType = response.headers.get("content-type") ?? "";
	const responseData = contentType.includes("application/json")
		? await response.json()
		: await response.text();

	const textBlocks = findTextBlocks(responseData, params.width, params.height);
	if (textBlocks?.length) {
		return {
			text_blocks: textBlocks,
			scale_factor: params.scaleFactor,
		};
	}

	const text = findText(responseData);
	return {
		text_blocks: text
			? [createFullImageTextBlock(text, params.width, params.height)]
			: [],
		scale_factor: params.scaleFactor,
	};
};
