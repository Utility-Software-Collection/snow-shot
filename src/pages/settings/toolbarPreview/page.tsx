"use client";

import {
	CheckOutlined,
	CloseOutlined,
	CopyOutlined,
	DragOutlined,
	HolderOutlined,
	LockOutlined,
	MoreOutlined,
	RedoOutlined,
	UndoOutlined,
} from "@ant-design/icons";
import {
	ProForm,
	ProFormSelect,
	ProFormSlider,
	ProFormSwitch,
} from "@ant-design/pro-components";
import {
	Button,
	type CheckboxOptionType,
	Col,
	ColorPicker,
	Divider,
	Flex,
	Form,
	Row,
	Spin,
	Tooltip,
	theme,
} from "antd";
import type { AggregationColor } from "antd/es/color-picker/color";
import {
	type DragEvent,
	type FC,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ContentWrap } from "@/components/contentWrap";
import { GroupTitle } from "@/components/groupTitle";
import { IconLabel } from "@/components/iconLable";
import {
	ArrowSelectIcon,
	BlurIcon,
	CircleIcon,
	DragWindowIcon,
	DrawArrowIcon,
	EraserIcon,
	FastSaveIcon,
	FixedIcon,
	HighlightIcon,
	MosaicIcon,
	OcrDetectIcon,
	OcrTranslateIcon,
	PenIcon,
	RectIcon,
	SaveIcon,
	SaveToCloudIcon,
	ScrollScreenshotIcon,
	SerialNumberIcon,
	TextIcon,
	WatermarkIcon,
} from "@/components/icons";
import {
	PLUGIN_ID_RAPID_OCR,
	PLUGIN_ID_TRANSLATE,
} from "@/constants/pluginService";
import { normalizeToolbarToolOrder } from "@/constants/toolbarToolOrder";
import { AppSettingsActionContext } from "@/contexts/appSettingsActionContext";
import { usePluginServiceContext } from "@/contexts/pluginServiceContext";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import {
	type AppSettingsData,
	AppSettingsGroup,
	CanHiddenToolSet,
} from "@/types/appSettings";
import { DrawState } from "@/types/draw";

type ToolbarPreviewState = {
	screenshot: AppSettingsData[AppSettingsGroup.Screenshot];
	functionScreenshot: AppSettingsData[AppSettingsGroup.FunctionScreenshot];
	functionDraw: AppSettingsData[AppSettingsGroup.FunctionDraw];
	cache: AppSettingsData[AppSettingsGroup.Cache];
	fixedContent: AppSettingsData[AppSettingsGroup.FixedContent];
};

type PreviewTool = {
	key: string;
	label: string;
	icon: ReactNode;
	drawState?: DrawState;
	active?: boolean;
	danger?: boolean;
	primary?: boolean;
	splitter?: boolean;
};

const isColorObject = (value: unknown): value is AggregationColor => {
	return typeof value === "object" && value !== null && "toHexString" in value;
};

const PreviewButton: FC<{
	tool: PreviewTool;
	canDrag?: boolean;
	dragging?: boolean;
	onDragStart?: (tool: PreviewTool) => void;
	onDragOver?: (tool: PreviewTool, event: DragEvent) => void;
	onDrop?: (tool: PreviewTool) => void;
	onDragEnd?: () => void;
}> = ({
	tool,
	canDrag,
	dragging,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
}) => {
	const { token } = theme.useToken();
	return (
		<Tooltip title={tool.label}>
			<Button
				aria-label={tool.label}
				draggable={canDrag}
				icon={tool.icon}
				type={tool.active || tool.primary ? "primary" : "text"}
				danger={tool.danger}
				size="middle"
				onDragStart={() => {
					onDragStart?.(tool);
				}}
				onDragOver={(event) => {
					onDragOver?.(tool, event);
				}}
				onDrop={() => {
					onDrop?.(tool);
				}}
				onDragEnd={onDragEnd}
				style={{
					cursor: canDrag ? "grab" : undefined,
					opacity: dragging ? 0.45 : 1,
					color: tool.primary
						? undefined
						: tool.danger
							? token.colorError
							: undefined,
				}}
			/>
		</Tooltip>
	);
};

const ToolbarPreview: FC<{
	title: ReactNode;
	scale?: number;
	tools: PreviewTool[];
	onReorder?: (source: DrawState, target: DrawState) => void;
}> = ({ title, scale = 1, tools, onReorder }) => {
	const { token } = theme.useToken();
	const [draggingTool, setDraggingTool] = useState<DrawState>();
	return (
		<div className="toolbar-preview-section">
			<div className="toolbar-preview-title">{title}</div>
			<div className="toolbar-preview-toolbar-scroll">
				<div
					className="toolbar-preview-toolbar-wrap"
					style={{
						transform: `scale(${scale})`,
					}}
				>
					<Flex
						align="center"
						gap={token.paddingXS}
						className="toolbar-preview-toolbar"
					>
						{tools.map((tool) => {
							if (tool.splitter) {
								return (
									<div key={tool.key} className="toolbar-preview-splitter" />
								);
							}
							return (
								<PreviewButton
									key={tool.key}
									tool={tool}
									canDrag={!!tool.drawState && !!onReorder}
									dragging={draggingTool === tool.drawState}
									onDragStart={(item) => {
										if (item.drawState === undefined) {
											return;
										}
										setDraggingTool(item.drawState);
									}}
									onDragOver={(item, event) => {
										if (!draggingTool || item.drawState === undefined) {
											return;
										}
										event.preventDefault();
									}}
									onDrop={(item) => {
										if (
											draggingTool === undefined ||
											item.drawState === undefined
										) {
											return;
										}
										onReorder?.(draggingTool, item.drawState);
										setDraggingTool(undefined);
									}}
									onDragEnd={() => {
										setDraggingTool(undefined);
									}}
								/>
							);
						})}
					</Flex>
				</div>
			</div>
		</div>
	);
};

export const ToolbarPreviewSettingsPage = () => {
	const intl = useIntl();
	const { token } = theme.useToken();
	const { updateAppSettings } = useContext(AppSettingsActionContext);
	const { isReadyStatus } = usePluginServiceContext();

	const [screenshotForm] =
		Form.useForm<AppSettingsData[AppSettingsGroup.Screenshot]>();
	const [functionScreenshotForm] =
		Form.useForm<AppSettingsData[AppSettingsGroup.FunctionScreenshot]>();
	const [functionDrawForm] =
		Form.useForm<AppSettingsData[AppSettingsGroup.FunctionDraw]>();
	const [cacheForm] = Form.useForm<AppSettingsData[AppSettingsGroup.Cache]>();
	const [fixedContentForm] =
		Form.useForm<AppSettingsData[AppSettingsGroup.FixedContent]>();

	const [appSettingsLoading, setAppSettingsLoading] = useState(true);
	const [previewState, setPreviewState] = useState<ToolbarPreviewState>();

	useAppSettingsLoad(
		useCallback(
			(settings: AppSettingsData, preSettings?: AppSettingsData) => {
				setAppSettingsLoading(false);
				setPreviewState({
					screenshot: settings[AppSettingsGroup.Screenshot],
					functionScreenshot: settings[AppSettingsGroup.FunctionScreenshot],
					functionDraw: settings[AppSettingsGroup.FunctionDraw],
					cache: settings[AppSettingsGroup.Cache],
					fixedContent: settings[AppSettingsGroup.FixedContent],
				});

				if (
					preSettings === undefined ||
					preSettings[AppSettingsGroup.Screenshot] !==
						settings[AppSettingsGroup.Screenshot]
				) {
					screenshotForm.setFieldsValue(settings[AppSettingsGroup.Screenshot]);
				}

				if (
					preSettings === undefined ||
					preSettings[AppSettingsGroup.FunctionScreenshot] !==
						settings[AppSettingsGroup.FunctionScreenshot]
				) {
					functionScreenshotForm.setFieldsValue(
						settings[AppSettingsGroup.FunctionScreenshot],
					);
				}

				if (
					preSettings === undefined ||
					preSettings[AppSettingsGroup.FunctionDraw] !==
						settings[AppSettingsGroup.FunctionDraw]
				) {
					functionDrawForm.setFieldsValue(
						settings[AppSettingsGroup.FunctionDraw],
					);
				}

				if (
					preSettings === undefined ||
					preSettings[AppSettingsGroup.Cache] !==
						settings[AppSettingsGroup.Cache]
				) {
					cacheForm.setFieldsValue(settings[AppSettingsGroup.Cache]);
				}

				if (
					preSettings === undefined ||
					preSettings[AppSettingsGroup.FixedContent] !==
						settings[AppSettingsGroup.FixedContent]
				) {
					fixedContentForm.setFieldsValue(
						settings[AppSettingsGroup.FixedContent],
					);
				}
			},
			[
				cacheForm,
				fixedContentForm,
				functionDrawForm,
				functionScreenshotForm,
				screenshotForm,
			],
		),
		true,
	);

	const toolbarToolOptions = useMemo<CheckboxOptionType<DrawState>[]>(() => {
		const options: CheckboxOptionType<DrawState>[] = [
			{
				label: intl.formatMessage({ id: "draw.selectTool" }),
				value: DrawState.Select,
			},
			{
				label: intl.formatMessage({ id: "draw.ellipseTool" }),
				value: DrawState.Ellipse,
			},
			{
				label: intl.formatMessage({ id: "draw.arrowTool" }),
				value: DrawState.Arrow,
			},
			{
				label: intl.formatMessage({ id: "draw.penTool" }),
				value: DrawState.Pen,
			},
			{
				label: intl.formatMessage({ id: "draw.textTool" }),
				value: DrawState.Text,
			},
			{
				label: intl.formatMessage({ id: "draw.serialNumberTool" }),
				value: DrawState.SerialNumber,
			},
			{
				label: intl.formatMessage({ id: "draw.blurTool" }),
				value: DrawState.Blur,
			},
			{
				label: intl.formatMessage({ id: "draw.mosaicTool" }),
				value: DrawState.Mosaic,
			},
			{
				label: intl.formatMessage({ id: "draw.eraserTool" }),
				value: DrawState.Eraser,
			},
			{
				label: intl.formatMessage({ id: "draw.watermarkTool" }),
				value: DrawState.Watermark,
			},
			{
				label: intl.formatMessage({ id: "draw.highlightTool" }),
				value: DrawState.Highlight,
			},
			{
				label: intl.formatMessage({ id: "draw.redoUndoTool" }),
				value: DrawState.Redo,
			},
			{
				label: intl.formatMessage({ id: "draw.fixedTool" }),
				value: DrawState.Fixed,
			},
			{
				label: intl.formatMessage({ id: "draw.ocrDetectTool" }),
				value: DrawState.OcrDetect,
			},
			{
				label: intl.formatMessage({ id: "draw.ocrTranslateTool" }),
				value: DrawState.OcrTranslate,
			},
			{
				label: intl.formatMessage({ id: "draw.scrollScreenshotTool" }),
				value: DrawState.ScrollScreenshot,
			},
		];

		return options.filter((item) => {
			if (!CanHiddenToolSet.has(item.value)) {
				return false;
			}

			if (
				item.value === DrawState.OcrDetect ||
				item.value === DrawState.OcrTranslate
			) {
				return isReadyStatus?.(PLUGIN_ID_RAPID_OCR) ?? false;
			}

			return true;
		});
	}, [intl, isReadyStatus]);

	const isToolHidden = useCallback(
		(drawState: DrawState) => {
			return (
				previewState?.screenshot.toolbarHiddenToolList.includes(drawState) ??
				false
			);
		},
		[previewState],
	);

	const createSplitter = useCallback((key: string): PreviewTool => {
		return {
			key,
			label: "",
			icon: null,
			splitter: true,
		};
	}, []);

	const screenshotTools = useMemo<PreviewTool[]>(() => {
		if (!previewState) {
			return [];
		}

		const tools: (PreviewTool | false)[] = [
			{
				key: "drag",
				label: intl.formatMessage({ id: "draw.drag" }),
				icon: <HolderOutlined />,
			},
			{
				key: "move",
				label: intl.formatMessage({ id: "draw.moveTool" }),
				icon: <DragOutlined />,
				drawState: DrawState.Idle,
			},
			!isToolHidden(DrawState.Select) && {
				key: "select",
				label: intl.formatMessage({ id: "draw.selectTool" }),
				icon: <ArrowSelectIcon />,
				drawState: DrawState.Select,
				active: true,
			},
			!previewState.functionDraw.lockDrawTool && {
				key: "lock",
				label: intl.formatMessage({
					id: "settings.functionSettings.screenshotSettings.lockDrawTool",
				}),
				icon: <LockOutlined />,
				drawState: DrawState.Lock,
				active: previewState.cache.enableLockDrawTool,
			},
			!isToolHidden(DrawState.Rect) && {
				key: "rect",
				label: intl.formatMessage({ id: "draw.rectTool" }),
				icon: <RectIcon />,
				drawState: DrawState.Rect,
			},
			!isToolHidden(DrawState.Ellipse) && {
				key: "ellipse",
				label: intl.formatMessage({ id: "draw.ellipseTool" }),
				icon: <CircleIcon />,
				drawState: DrawState.Ellipse,
			},
			!isToolHidden(DrawState.Arrow) && {
				key: "arrow",
				label: intl.formatMessage({ id: "draw.arrowTool" }),
				icon: <DrawArrowIcon />,
				drawState: DrawState.Arrow,
			},
			!isToolHidden(DrawState.Pen) && {
				key: "pen",
				label: intl.formatMessage({ id: "draw.penTool" }),
				icon: <PenIcon />,
				drawState: DrawState.Pen,
			},
			!isToolHidden(DrawState.Text) && {
				key: "text",
				label: intl.formatMessage({ id: "draw.textTool" }),
				icon: <TextIcon />,
				drawState: DrawState.Text,
			},
			!isToolHidden(DrawState.SerialNumber) && {
				key: "serial-number",
				label: intl.formatMessage({ id: "draw.serialNumberTool" }),
				icon: <SerialNumberIcon />,
				drawState: DrawState.SerialNumber,
			},
			!isToolHidden(DrawState.Blur) && {
				key: "blur",
				label: intl.formatMessage({ id: "draw.blurTool" }),
				icon: <BlurIcon />,
				drawState: DrawState.Blur,
			},
			!isToolHidden(DrawState.Mosaic) && {
				key: "mosaic",
				label: intl.formatMessage({ id: "draw.mosaicTool" }),
				icon: <MosaicIcon />,
				drawState: DrawState.Mosaic,
			},
			!isToolHidden(DrawState.Eraser) && {
				key: "eraser",
				label: intl.formatMessage({ id: "draw.eraserTool" }),
				icon: <EraserIcon />,
				drawState: DrawState.Eraser,
			},
			(!isToolHidden(DrawState.Watermark) ||
				!isToolHidden(DrawState.Highlight)) && {
				key: "draw-extra",
				label: intl.formatMessage({ id: "draw.watermarkTool" }),
				icon: <MoreOutlined />,
				drawState: DrawState.DrawExtraTools,
			},
			!isToolHidden(DrawState.Redo) && {
				key: "undo",
				label: intl.formatMessage({ id: "draw.undoTool" }),
				icon: <UndoOutlined />,
				drawState: DrawState.Undo,
			},
			!isToolHidden(DrawState.Redo) && {
				key: "redo",
				label: intl.formatMessage({ id: "draw.redoTool" }),
				icon: <RedoOutlined />,
				drawState: DrawState.Redo,
			},
			{
				key: "extra",
				label: intl.formatMessage({ id: "draw.extraToolsTool" }),
				icon: <MoreOutlined />,
				drawState: DrawState.ExtraTools,
			},
			!isToolHidden(DrawState.Fixed) && {
				key: "fixed",
				label: intl.formatMessage({ id: "draw.fixedTool" }),
				icon: <FixedIcon />,
				drawState: DrawState.Fixed,
			},
			!isToolHidden(DrawState.OcrDetect) &&
				(isReadyStatus?.(PLUGIN_ID_RAPID_OCR) ?? false) && {
					key: "ocr-detect",
					label: intl.formatMessage({ id: "draw.ocrDetectTool" }),
					icon: <OcrDetectIcon />,
					drawState: DrawState.OcrDetect,
				},
			!isToolHidden(DrawState.OcrTranslate) &&
				(isReadyStatus?.(PLUGIN_ID_RAPID_OCR) ?? false) &&
				(isReadyStatus?.(PLUGIN_ID_TRANSLATE) ?? false) && {
					key: "ocr-translate",
					label: intl.formatMessage({ id: "draw.ocrTranslateTool" }),
					icon: <OcrTranslateIcon />,
					drawState: DrawState.OcrTranslate,
				},
			!isToolHidden(DrawState.ScrollScreenshot) && {
				key: "scroll-screenshot",
				label: intl.formatMessage({ id: "draw.scrollScreenshotTool" }),
				icon: <ScrollScreenshotIcon />,
				drawState: DrawState.ScrollScreenshot,
			},
			previewState.functionScreenshot.fastSave && {
				key: "fast-save",
				label: intl.formatMessage({
					id: "settings.functionSettings.screenshotSettings.autoSaveFileMode.fastSave",
				}),
				icon: <FastSaveIcon />,
				drawState: DrawState.FastSave,
			},
			previewState.functionScreenshot.saveToCloud && {
				key: "save-to-cloud",
				label: intl.formatMessage({
					id: "settings.functionSettings.screenshotSettings.saveToCloud",
				}),
				icon: <SaveToCloudIcon />,
				drawState: DrawState.SaveToCloud,
			},
			{
				key: "save",
				label: intl.formatMessage({ id: "draw.saveTool" }),
				icon: <SaveIcon />,
				drawState: DrawState.Save,
			},
			{
				key: "cancel",
				label: intl.formatMessage({ id: "draw.cancelTool" }),
				icon: <CloseOutlined />,
				drawState: DrawState.Cancel,
				danger: true,
			},
			{
				key: "copy",
				label: intl.formatMessage({ id: "draw.copyTool" }),
				icon: <CopyOutlined />,
				drawState: DrawState.Copy,
				primary: true,
			},
		];

		const order = normalizeToolbarToolOrder(
			previewState.screenshot.toolbarToolOrder,
		);
		const getOrderIndex = (tool: PreviewTool) =>
			tool.drawState === undefined ? -1 : order.indexOf(tool.drawState);

		return (tools.filter(Boolean) as PreviewTool[]).sort(
			(a, b) => getOrderIndex(a) - getOrderIndex(b),
		);
	}, [intl, isReadyStatus, isToolHidden, previewState]);

	const fixedContentTools = useMemo<PreviewTool[]>(() => {
		if (!previewState) {
			return [];
		}

		const tools: (PreviewTool | false)[] = [
			{
				key: "drag",
				label: intl.formatMessage({ id: "draw.drag" }),
				icon: <HolderOutlined />,
			},
			{
				key: "drag-window",
				label: intl.formatMessage({ id: "draw.dragWindow" }),
				icon: <DragWindowIcon />,
			},
			{
				key: "select",
				label: intl.formatMessage({ id: "draw.selectTool" }),
				icon: <ArrowSelectIcon />,
				active: true,
			},
			!previewState.functionDraw.lockDrawTool && {
				key: "lock",
				label: intl.formatMessage({
					id: "settings.functionSettings.screenshotSettings.lockDrawTool",
				}),
				icon: <LockOutlined />,
				active: previewState.cache.enableLockDrawTool,
			},
			createSplitter("fixed-splitter-draw-start"),
			{
				key: "rect",
				label: intl.formatMessage({ id: "draw.rectTool" }),
				icon: <RectIcon />,
			},
			{
				key: "ellipse",
				label: intl.formatMessage({ id: "draw.ellipseTool" }),
				icon: <CircleIcon />,
			},
			{
				key: "arrow",
				label: intl.formatMessage({ id: "draw.arrowTool" }),
				icon: <DrawArrowIcon />,
			},
			{
				key: "pen",
				label: intl.formatMessage({ id: "draw.penTool" }),
				icon: <PenIcon />,
			},
			{
				key: "text",
				label: intl.formatMessage({ id: "draw.textTool" }),
				icon: <TextIcon />,
			},
			{
				key: "serial-number",
				label: intl.formatMessage({ id: "draw.serialNumberTool" }),
				icon: <SerialNumberIcon />,
			},
			{
				key: "blur",
				label: intl.formatMessage({ id: "draw.blurTool" }),
				icon: <BlurIcon />,
			},
			{
				key: "mosaic",
				label: intl.formatMessage({ id: "draw.mosaicTool" }),
				icon: <MosaicIcon />,
			},
			{
				key: "eraser",
				label: intl.formatMessage({ id: "draw.eraserTool" }),
				icon: <EraserIcon />,
			},
			{
				key: "watermark",
				label: intl.formatMessage({ id: "draw.watermarkTool" }),
				icon: <WatermarkIcon />,
			},
			{
				key: "highlight",
				label: intl.formatMessage({ id: "draw.highlightTool" }),
				icon: <HighlightIcon />,
			},
			createSplitter("fixed-splitter-history"),
			{
				key: "undo",
				label: intl.formatMessage({ id: "draw.undoTool" }),
				icon: <UndoOutlined />,
			},
			{
				key: "redo",
				label: intl.formatMessage({ id: "draw.redoTool" }),
				icon: <RedoOutlined />,
			},
			createSplitter("fixed-splitter-action"),
			{
				key: "confirm",
				label: intl.formatMessage({ id: "draw.confirm" }),
				icon: <CheckOutlined />,
				primary: true,
			},
		];

		return tools.filter(Boolean) as PreviewTool[];
	}, [createSplitter, intl, previewState]);

	const updatePreviewState = useCallback(
		<T extends keyof ToolbarPreviewState>(
			key: T,
			values: ToolbarPreviewState[T],
		) => {
			setPreviewState((prev) => {
				if (!prev) {
					return prev;
				}

				return {
					...prev,
					[key]: {
						...prev[key],
						...values,
					},
				};
			});
		},
		[],
	);

	const handleScreenshotToolbarReorder = useCallback(
		(source: DrawState, target: DrawState) => {
			if (!previewState || source === target) {
				return;
			}

			const order = normalizeToolbarToolOrder(
				previewState.screenshot.toolbarToolOrder,
			);
			const nextOrder = order.filter((item) => item !== source);
			const targetIndex = nextOrder.indexOf(target);
			nextOrder.splice(
				targetIndex < 0 ? nextOrder.length : targetIndex,
				0,
				source,
			);

			const nextScreenshotSettings = {
				...previewState.screenshot,
				toolbarToolOrder: nextOrder,
			};
			screenshotForm.setFieldsValue(nextScreenshotSettings);
			updatePreviewState("screenshot", nextScreenshotSettings);
			updateAppSettings(
				AppSettingsGroup.Screenshot,
				nextScreenshotSettings,
				true,
				true,
				true,
				true,
				false,
			);
		},
		[previewState, screenshotForm, updateAppSettings, updatePreviewState],
	);

	return (
		<ContentWrap className="toolbar-preview-settings-wrap">
			<GroupTitle id="toolbarPreview">
				<FormattedMessage id="settings.toolbarPreview" />
			</GroupTitle>

			<Spin spinning={appSettingsLoading || !previewState}>
				{previewState && (
					<div className="toolbar-preview-layout">
						<div className="toolbar-preview-panel">
							<ToolbarPreview
								title={
									<FormattedMessage id="settings.toolbarPreview.fixedContentToolbar" />
								}
								tools={fixedContentTools}
							/>

							<ToolbarPreview
								title={
									<FormattedMessage id="settings.toolbarPreview.screenshotToolbar" />
								}
								scale={previewState.screenshot.toolbarUiScale / 100}
								tools={screenshotTools}
								onReorder={handleScreenshotToolbarReorder}
							/>
						</div>

						<div className="toolbar-preview-settings">
							<GroupTitle id="toolbarPreviewScreenshot">
								<FormattedMessage id="settings.toolbarPreview.screenshotToolbar" />
							</GroupTitle>

							<ProForm<AppSettingsData[AppSettingsGroup.Screenshot]>
								form={screenshotForm}
								submitter={false}
								layout="vertical"
								onValuesChange={(_, values) => {
									if (isColorObject(values.selectRectMaskColor)) {
										values.selectRectMaskColor =
											values.selectRectMaskColor.toHexString();
									}

									updatePreviewState("screenshot", values);
									updateAppSettings(
										AppSettingsGroup.Screenshot,
										values,
										true,
										true,
										true,
										true,
										false,
									);
								}}
							>
								<Row gutter={token.marginLG}>
									<Col span={24}>
										<ProFormSlider
											name="toolbarUiScale"
											label={
												<FormattedMessage id="settings.commonSettings.screenshotSettings.toolbarUiScale" />
											}
											min={25}
											max={100}
											step={1}
											marks={{
												25: "25%",
												100: "100%",
											}}
										/>
									</Col>
									<Col span={24}>
										<ProForm.Item
											name="selectRectMaskColor"
											label={
												<IconLabel
													label={
														<FormattedMessage id="settings.selectRectMaskColor" />
													}
												/>
											}
											required={false}
										>
											<ColorPicker showText placement="bottom" />
										</ProForm.Item>
									</Col>
									<Col span={24}>
										<ProFormSelect
											name="toolbarHiddenToolList"
											label={
												<IconLabel
													label={
														<FormattedMessage id="settings.customToolbarToolList" />
													}
													tooltipTitle={
														<FormattedMessage id="settings.customToolbarToolList.tip" />
													}
												/>
											}
											options={toolbarToolOptions}
											mode="multiple"
										/>
									</Col>
								</Row>
							</ProForm>

							<Divider />

							<GroupTitle id="toolbarPreviewSwitches">
								<FormattedMessage id="settings.toolbarPreview.switches" />
							</GroupTitle>

							<ProForm<AppSettingsData[AppSettingsGroup.FunctionScreenshot]>
								form={functionScreenshotForm}
								submitter={false}
								layout="horizontal"
								onValuesChange={(_, values) => {
									updatePreviewState("functionScreenshot", values);
									updateAppSettings(
										AppSettingsGroup.FunctionScreenshot,
										values,
										true,
										true,
										true,
										true,
										false,
									);
								}}
							>
								<Row gutter={token.marginLG}>
									<Col span={12}>
										<ProFormSwitch
											name="fastSave"
											label={
												<IconLabel
													label={
														<FormattedMessage id="settings.functionSettings.screenshotSettings.autoSaveFileMode.fastSave" />
													}
													tooltipTitle={
														<FormattedMessage id="settings.functionSettings.screenshotSettings.autoSaveFileMode.fastSave.tip" />
													}
												/>
											}
										/>
									</Col>
									<Col span={12}>
										<ProFormSwitch
											name="saveToCloud"
											label={
												<IconLabel
													label={
														<FormattedMessage id="settings.functionSettings.screenshotSettings.saveToCloud" />
													}
													tooltipTitle={
														<FormattedMessage id="settings.functionSettings.screenshotSettings.saveToCloud.tip" />
													}
												/>
											}
										/>
									</Col>
									<Col span={12}>
										<ProFormSwitch
											name="shortcutCanleTip"
											label={
												<IconLabel
													label={
														<FormattedMessage id="settings.functionSettings.screenshotSettings.shortcutCanleTip" />
													}
													tooltipTitle={
														<FormattedMessage id="settings.functionSettings.screenshotSettings.shortcutCanleTip.tip" />
													}
												/>
											}
										/>
									</Col>
								</Row>
							</ProForm>

							<ProForm<AppSettingsData[AppSettingsGroup.FunctionDraw]>
								form={functionDrawForm}
								submitter={false}
								layout="horizontal"
								onValuesChange={(_, values) => {
									updatePreviewState("functionDraw", values);
									updateAppSettings(
										AppSettingsGroup.FunctionDraw,
										values,
										true,
										true,
										true,
										true,
										false,
									);
								}}
							>
								<Row gutter={token.marginLG}>
									<Col span={12}>
										<ProFormSwitch
											name="lockDrawTool"
											label={
												<FormattedMessage id="settings.functionSettings.screenshotSettings.lockDrawTool" />
											}
										/>
									</Col>
									<Col span={12}>
										<ProFormSwitch
											name="toolIndependentStyle"
											label={
												<IconLabel
													label={
														<FormattedMessage id="settings.commonSettings.draw.toolIndependentStyle" />
													}
													tooltipTitle={
														<FormattedMessage id="settings.commonSettings.draw.toolIndependentStyle.tip" />
													}
												/>
											}
										/>
									</Col>
								</Row>
							</ProForm>

							<ProForm<AppSettingsData[AppSettingsGroup.Cache]>
								form={cacheForm}
								submitter={false}
								layout="horizontal"
								onValuesChange={(_, values) => {
									updatePreviewState("cache", values);
									updateAppSettings(
										AppSettingsGroup.Cache,
										values,
										true,
										true,
										false,
										true,
										false,
									);
								}}
							>
								<Row gutter={token.marginLG}>
									<Col span={12}>
										<ProFormSwitch
											name="enableLockDrawTool"
											label={
												<FormattedMessage id="settings.toolbarPreview.enableLockButton" />
											}
										/>
									</Col>
								</Row>
							</ProForm>

							<Divider />

							<GroupTitle id="toolbarPreviewFixedContent">
								<FormattedMessage id="settings.toolbarPreview.fixedContentToolbar" />
							</GroupTitle>

							<ProForm<AppSettingsData[AppSettingsGroup.FixedContent]>
								form={fixedContentForm}
								submitter={false}
								layout="vertical"
								onValuesChange={(_, values) => {
									if (isColorObject(values.borderColor)) {
										values.borderColor = values.borderColor.toHexString();
									}

									updatePreviewState("fixedContent", values);
									updateAppSettings(
										AppSettingsGroup.FixedContent,
										values,
										true,
										true,
										true,
										true,
										false,
									);
								}}
							>
								<Row gutter={token.marginLG}>
									<Col span={24}>
										<ProForm.Item
											name="borderColor"
											label={
												<IconLabel
													label={
														<FormattedMessage id="settings.fixedContentSettings.borderColor" />
													}
												/>
											}
											required={false}
										>
											<ColorPicker showText placement="bottom" />
										</ProForm.Item>
									</Col>
								</Row>
							</ProForm>
						</div>
					</div>
				)}
			</Spin>

			<style jsx>{`
                .toolbar-preview-layout {
                    display: flex;
                    flex-direction: column;
                    gap: ${token.marginLG}px;
                }

                .toolbar-preview-settings {
                    min-width: 0;
                }

                .toolbar-preview-panel {
                    display: flex;
                    flex-direction: column;
                    gap: ${token.margin}px;
                    min-width: 0;
                    padding-bottom: ${token.paddingXS}px;
                }

                .toolbar-preview-section {
                    min-width: 0;
                }

                .toolbar-preview-title {
                    margin-bottom: ${token.marginSM}px;
                    color: ${token.colorTextSecondary};
                    font-size: ${token.fontSize}px;
                }

                .toolbar-preview-toolbar-scroll {
                    min-width: 0;
                    overflow-x: auto;
                    padding-bottom: ${token.paddingXXS}px;
                }

                .toolbar-preview-toolbar-wrap {
                    width: max-content;
                    transform-origin: top left;
                }

                .toolbar-preview-toolbar {
                    width: max-content;
                    padding: ${token.paddingXXS}px ${token.paddingSM}px;
                    box-sizing: border-box;
                    background-color: ${token.colorBgContainer};
                    border-radius: ${token.borderRadiusLG}px;
                    color: ${token.colorText};
                    box-shadow: 0 0 3px 0 ${token.colorPrimaryHover};
                }

                .toolbar-preview-toolbar :global(.ant-btn) :global(.ant-btn-icon) {
                    font-size: 24px;
                    display: flex;
                    align-items: center;
                }

                .toolbar-preview-toolbar :global(.ant-btn-icon) {
                    display: flex;
                    align-items: center;
                }

                .toolbar-preview-splitter {
                    width: 1px;
                    height: 0.83em;
                    background-color: ${token.colorBorder};
                    margin: 0 ${token.marginXXS}px;
                    flex: 0 0 auto;
                }

                @media (max-width: 980px) {
                    .toolbar-preview-panel {
                        position: static;
                    }
                }
            `}</style>
		</ContentWrap>
	);
};
