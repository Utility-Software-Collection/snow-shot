import { EXTERNAL_OCR_MODEL_PREFIX } from "@/constants/components/ocr";
import { PLUGIN_ID_RAPID_OCR } from "@/constants/pluginService";
import type { AppSettingsData, AppSettingsGroup } from "@/types/appSettings";

export const getExternalOcrModelValue = (modelName: string) =>
	`${EXTERNAL_OCR_MODEL_PREFIX}${modelName}`;

export const isExternalOcrModel = (ocrModel: string | undefined) =>
	!!ocrModel && ocrModel.startsWith(EXTERNAL_OCR_MODEL_PREFIX);

export const getExternalOcrModelName = (ocrModel: string) =>
	ocrModel.slice(EXTERNAL_OCR_MODEL_PREFIX.length);

export const getSelectedExternalOcrApiConfig = (
	ocrSettings: AppSettingsData[AppSettingsGroup.FunctionOcr] | undefined,
) => {
	if (!ocrSettings) {
		return undefined;
	}

	if (!isExternalOcrModel(ocrSettings.ocrModel)) {
		return undefined;
	}

	const modelName = getExternalOcrModelName(ocrSettings.ocrModel);
	return ocrSettings.externalOcrApiConfigList.find(
		(config) => config.model_name === modelName && config.api_uri,
	);
};

export const isOcrServiceAvailable = (
	ocrSettings: AppSettingsData[AppSettingsGroup.FunctionOcr] | undefined,
	isReady: ((pluginId: string) => boolean | undefined) | undefined,
) => {
	return (
		!!getSelectedExternalOcrApiConfig(ocrSettings) ||
		!!isReady?.(PLUGIN_ID_RAPID_OCR)
	);
};
