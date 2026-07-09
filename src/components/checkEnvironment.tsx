import { useCallback, useRef } from "react";
import {
	createWebViewSharedBuffer,
	setSupportWebViewSharedBuffer,
} from "@/commands/webview";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import {
	setDisableWebViewSharedBuffer,
	supportWebViewSharedBuffer,
} from "@/utils/environment";
import { appInfo } from "@/utils/log";
import {
	getWebViewSharedBuffer,
	releaseWebViewSharedBuffer,
} from "@/utils/webview";

export const CheckEnvironment = () => {
	const hasCheckedEnvironmentRef = useRef(false);
	const checkVersionRef = useRef(0);
	const checkEnvironment = useCallback(async () => {
		if (hasCheckedEnvironmentRef.current) {
			return;
		}
		hasCheckedEnvironmentRef.current = true;
		const checkVersion = checkVersionRef.current;

		if (!supportWebViewSharedBuffer()) {
			setSupportWebViewSharedBuffer(false);
			return;
		}

		const testData = new Uint8Array([83]);
		const receiveDataPromise = getWebViewSharedBuffer(
			undefined,
			"check_environment",
		);
		await createWebViewSharedBuffer(testData.buffer, "check_environment");
		const receiveData = await receiveDataPromise;
		if (!receiveData) {
			return;
		}

		if (receiveData.byteLength !== testData.byteLength) {
			return;
		}

		if (
			!new Uint8Array(receiveData).every(
				(value, index) => value === testData[index],
			)
		) {
			return;
		}

		if (
			checkVersion !== checkVersionRef.current ||
			!supportWebViewSharedBuffer()
		) {
			releaseWebViewSharedBuffer(receiveData);
			setSupportWebViewSharedBuffer(false);
			return;
		}

		appInfo("[CheckEnvironment] Support WebView Shared Buffer");
		setSupportWebViewSharedBuffer(true);
		releaseWebViewSharedBuffer(receiveData);
	}, []);

	useAppSettingsLoad(
		useCallback(
			(settings: AppSettingsData, preSettings?: AppSettingsData) => {
				const disableWebViewSharedBuffer =
					settings[AppSettingsGroup.FunctionBranch].disableWebViewSharedBuffer;

				if (
					preSettings?.[AppSettingsGroup.FunctionBranch]
						.disableWebViewSharedBuffer !== disableWebViewSharedBuffer
				) {
					checkVersionRef.current += 1;
					hasCheckedEnvironmentRef.current = false;
				}

				setDisableWebViewSharedBuffer(disableWebViewSharedBuffer);

				if (disableWebViewSharedBuffer) {
					setSupportWebViewSharedBuffer(false);
					return;
				}

				checkEnvironment();
			},
			[checkEnvironment],
		),
		true,
	);

	return undefined;
};
