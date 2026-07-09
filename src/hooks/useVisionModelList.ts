import { useCallback, useMemo, useRef } from "react";
import { CUSTOM_MODEL_PREFIX } from "@/constants/components/chat";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { getUrl } from "@/services/tools";
import { getChatModelsWithCache } from "@/services/tools/chat";
import { AppSettingsGroup, type ChatApiConfig } from "@/types/appSettings";

export type VisionModel = {
	config: ChatApiConfig;
	isOfficial: boolean;
};

export const useVisionModelList = () => {
	const [getAppSettings] = useStateSubscriber(AppSettingsPublisher, undefined);
	const customVisionModelListRef = useRef<VisionModel[]>(undefined);

	const getVisionModelList = useCallback(async () => {
		const settings = getAppSettings();
		const visionModelList = settings[
			AppSettingsGroup.FunctionChat
		].chatApiConfigList
			.filter((config) => config.support_vision)
			.map((config) => {
				return {
					config: {
						...config,
						api_model: `${CUSTOM_MODEL_PREFIX}${config.api_model}`,
					},
					isOfficial: false,
				};
			});

		if (!customVisionModelListRef.current) {
			const res = await getChatModelsWithCache();
			customVisionModelListRef.current = (res ?? [])
				.filter((item) => item.support_vision)
				.map((item) => {
					return {
						config: {
							api_uri: getUrl("api/v1/"),
							api_key: "",
							api_model: item.model,
							model_name: item.name,
							support_thinking: item.thinking,
							support_vision: item.support_vision,
						},
						isOfficial: true,
					};
				});
		}

		return [...visionModelList, ...customVisionModelListRef.current];
	}, [getAppSettings]);

	return useMemo(() => {
		return {
			getVisionModelList,
		};
	}, [getVisionModelList]);
};
