import type { ExcalidrawPropsCustomOptions } from "@mg-chao/excalidraw/types";
import { Checkbox, Flex, Input } from "antd";
import { debounce } from "es-toolkit";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
	AppSettingsActionContext,
	AppSettingsPublisher,
} from "@/contexts/appSettingsActionContext";
import { useStateRef } from "@/hooks/useStateRef";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { DrawContext } from "@/pages/fullScreenDraw/extra";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import { ExcalidrawEventPublisher } from "../extra";

const WatermarkTextInput = () => {
	const intl = useIntl();
	const [, setDrawEvent] = useStateSubscriber(
		ExcalidrawEventPublisher,
		undefined,
	);
	const { updateAppSettings } = useContext(AppSettingsActionContext);
	const { getDrawCoreAction } = useContext(DrawContext);
	const [watermarkText, setWatermarkText, watermarkTextRef] =
		useStateRef<string>("");
	const [parseTextAsDate, setParseTextAsDate] = useStateRef(false);
	useStateSubscriber(
		AppSettingsPublisher,
		useCallback(
			(settings: AppSettingsData) => {
				setParseTextAsDate(
					settings[AppSettingsGroup.Cache].parseWatermarkTextAsDate,
				);
			},
			[setParseTextAsDate],
		),
	);

	const updateWatermarkText = useMemo(() => {
		return debounce(() => {
			setDrawEvent({
				event: "onWatermarkTextChange",
				params: {
					text: watermarkTextRef.current,
				},
			});
			setDrawEvent(undefined);
		}, 128);
	}, [setDrawEvent, watermarkTextRef]);

	const refreshWatermarkText = useMemo(() => {
		return debounce(() => {
			const sceneElements = getDrawCoreAction()
				?.getExcalidrawAPI()
				?.getSceneElements();
			if (!sceneElements) {
				return;
			}

			const watermarkElement = sceneElements.find(
				(element) => element.type === "watermark",
			);

			setWatermarkText(watermarkElement?.watermarkText ?? "");
		}, 128);
	}, [getDrawCoreAction, setWatermarkText]);

	useEffect(() => {
		refreshWatermarkText();
	}, [refreshWatermarkText]);

	const onChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setWatermarkText(e.target.value);
			updateWatermarkText();
		},
		[setWatermarkText, updateWatermarkText],
	);

	const onMouseDown = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
		e.stopPropagation();
	}, []);

	const onMouseUp = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
		e.stopPropagation();
	}, []);

	const onParseTextAsDateChange = useCallback(
		(e: { target: { checked: boolean } }) => {
			updateAppSettings(
				AppSettingsGroup.Cache,
				{
					parseWatermarkTextAsDate: e.target.checked,
				},
				true,
				true,
				false,
				true,
				false,
			);
		},
		[updateAppSettings],
	);

	return (
		<Flex vertical gap={6}>
			<Input
				value={watermarkText}
				onChange={onChange}
				onMouseDown={onMouseDown}
				onMouseUp={onMouseUp}
				placeholder={intl.formatMessage({
					id: "draw.watermarkTool.text.placeholder",
				})}
			/>
			<Checkbox checked={parseTextAsDate} onChange={onParseTextAsDateChange}>
				<FormattedMessage id="draw.watermarkTool.parseTextAsDate" />
			</Checkbox>
		</Flex>
	);
};

const SubToolEditor: NonNullable<
	NonNullable<ExcalidrawPropsCustomOptions["pickerRenders"]>["SubToolEditor"]
> = ({ appState, targetElements }) => {
	const watermarkSubTools = useMemo(() => {
		if (appState.activeTool.type !== "watermark") {
			return undefined;
		}

		return <WatermarkTextInput />;
	}, [appState.activeTool.type]);

	if (watermarkSubTools && targetElements.length === 0) {
		return (
			<fieldset>
				<legend>
					<FormattedMessage id="draw.watermarkTool.text" />
				</legend>
				<div>{watermarkSubTools}</div>
			</fieldset>
		);
	}

	return undefined;
};

export default SubToolEditor;
