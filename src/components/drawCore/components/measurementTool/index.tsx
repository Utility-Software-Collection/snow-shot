import type {
	ExcalidrawElement,
	ExcalidrawLinearElement,
	ExcalidrawTextElement,
} from "@mg-chao/excalidraw/element/types";
import type { AppState } from "@mg-chao/excalidraw/types";
import { Form, Input, InputNumber, Modal } from "antd";
import type React from "react";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import {
	AppSettingsActionContext,
	AppSettingsPublisher,
} from "@/contexts/appSettingsActionContext";
import { useStateRef } from "@/hooks/useStateRef";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import { DrawState } from "@/types/draw";
import {
	DrawCoreContext,
	DrawStatePublisher,
	type ExcalidrawEventParams,
	ExcalidrawEventPublisher,
} from "../../extra";

type Point = [number, number];

type MeasurementCalibrationForm = {
	value: number;
	unit: string;
};

const measurementElementIdPrefix = "snow-shot_measurement_";

const isMeasurementTextElement = (element: ExcalidrawElement | undefined) => {
	return element?.id.startsWith(measurementElementIdPrefix);
};

const getArrowAbsolutePoints = (element: ExcalidrawLinearElement): Point[] => {
	return element.points.map((point) => [
		element.x + point[0],
		element.y + point[1],
	]);
};

const getDistance = (start: Point, end: Point) => {
	return Math.hypot(end[0] - start[0], end[1] - start[1]);
};

const getPolylineDistance = (points: Point[]) => {
	let distance = 0;
	for (let i = 1; i < points.length; i++) {
		distance += getDistance(points[i - 1], points[i]);
	}
	return distance;
};

const getPolylineMiddlePoint = (points: Point[]) => {
	const totalDistance = getPolylineDistance(points);
	if (totalDistance <= 0 || points.length === 0) {
		return points[0] ?? [0, 0];
	}

	let walkedDistance = 0;
	const middleDistance = totalDistance / 2;
	for (let i = 1; i < points.length; i++) {
		const start = points[i - 1];
		const end = points[i];
		const segmentDistance = getDistance(start, end);
		if (walkedDistance + segmentDistance >= middleDistance) {
			const rate = (middleDistance - walkedDistance) / segmentDistance;
			return [
				start[0] + (end[0] - start[0]) * rate,
				start[1] + (end[1] - start[1]) * rate,
			] as Point;
		}
		walkedDistance += segmentDistance;
	}

	return points[points.length - 1];
};

const formatMeasurementValue = (value: number) => {
	if (!Number.isFinite(value)) {
		return "0";
	}

	const precision = value >= 100 ? 1 : 2;
	return Number(value.toFixed(precision)).toString();
};

const createMeasurementTextElement = (
	position: Point,
	text: string,
	groupId: string,
	appState: AppState,
): ExcalidrawTextElement => {
	const fontSize = appState.currentItemFontSize;
	const width = Math.max(text.length * fontSize * 0.62, fontSize * 3);
	const height = fontSize * 1.5;

	return {
		id: `${measurementElementIdPrefix}${Date.now()}_${Math.random()
			.toString(36)
			.slice(2)}-text`,
		type: "text",
		x: position[0] - width / 2,
		y: position[1] - height - 8,
		width,
		height,
		angle: 0,
		textStrokeColor: "transparent",
		textBackgroundColor: "transparent",
		strokeColor: appState.currentItemStrokeColor,
		backgroundColor: "transparent",
		fillStyle: appState.currentItemFillStyle,
		strokeWidth: appState.currentItemStrokeWidth,
		strokeStyle: appState.currentItemStrokeStyle,
		roughness: appState.currentItemRoughness,
		opacity: appState.currentItemOpacity,
		groupIds: [groupId],
		frameId: null,
		roundness: null,
		version: 1,
		versionNonce: Math.floor(Math.random() * 1_000_000_000),
		isDeleted: false,
		boundElements: [],
		link: null,
		locked: false,
		text,
		fontSize,
		fontFamily: appState.currentItemFontFamily,
		textAlign: "center",
		verticalAlign: "middle",
		containerId: null,
		originalText: text,
		autoResize: false,
		lineHeight: 1.25 as ExcalidrawTextElement["lineHeight"],
		seed: Math.floor(Math.random() * 1_000_000_000),
		index: null,
		updated: Date.now(),
	};
};

export const MeasurementTool: React.FC = () => {
	const intl = useIntl();
	const { getAction } = useContext(DrawCoreContext);
	const { updateAppSettings } = useContext(AppSettingsActionContext);
	const [form] = Form.useForm<MeasurementCalibrationForm>();

	const arrowElementIdsRef = useRef<Set<string>>(new Set());
	const pendingCalibrationRef = useRef<
		| {
				arrowElement: ExcalidrawLinearElement;
				pixelLength: number;
				middlePoint: Point;
		  }
		| undefined
	>(undefined);
	const [_enable, setEnable, enableRef] = useStateRef(false);
	const [_drawState, setDrawState, drawStateRef] = useStateRef(DrawState.Idle);
	const [calibrationOpen, setCalibrationOpen] = useState(false);
	const [cacheSettings, setCacheSettings] =
		useState<AppSettingsData[AppSettingsGroup.Cache]>();

	useStateSubscriber(
		AppSettingsPublisher,
		useCallback((settings: AppSettingsData) => {
			setCacheSettings(settings[AppSettingsGroup.Cache]);
		}, []),
	);

	const measurementScaleText = useMemo(() => {
		if (
			!cacheSettings?.measurementScalePixels ||
			!cacheSettings.measurementScaleValue
		) {
			return "px";
		}

		return `${formatMeasurementValue(
			cacheSettings.measurementScaleValue,
		)} ${cacheSettings.measurementScaleUnit} / ${formatMeasurementValue(
			cacheSettings.measurementScalePixels,
		)} px`;
	}, [cacheSettings]);

	const resetArrowElementIds = useCallback(() => {
		arrowElementIdsRef.current = new Set(
			getAction()
				?.getExcalidrawAPI()
				?.getSceneElements()
				.filter((item) => item.type === "arrow")
				.map((item) => item.id),
		);
	}, [getAction]);

	useStateSubscriber(
		DrawStatePublisher,
		useCallback(
			(nextDrawState: DrawState) => {
				const isEnable =
					nextDrawState === DrawState.DimensionCalibrate ||
					nextDrawState === DrawState.DimensionMeasure;
				setDrawState(nextDrawState);
				setEnable(isEnable);
				if (isEnable) {
					resetArrowElementIds();
				}
			},
			[resetArrowElementIds, setDrawState, setEnable],
		),
	);

	const appendMeasurementText = useCallback(
		(
			arrowElement: ExcalidrawLinearElement,
			text: string,
			middlePoint: Point,
		) => {
			const action = getAction();
			const appState = action?.getAppState();
			const sceneElements = action?.getExcalidrawAPI()?.getSceneElements();
			if (!action || !appState || !sceneElements) {
				return;
			}

			const groupId = `${measurementElementIdPrefix}${Date.now()}_group`;
			const textElement = createMeasurementTextElement(
				middlePoint,
				text,
				groupId,
				appState,
			);

			action.updateScene({
				elements: [
					...sceneElements.map((element) => {
						if (element.id !== arrowElement.id) {
							return element;
						}

						return {
							...element,
							groupIds: [...element.groupIds, groupId],
							version: element.version + 1,
							updated: Date.now(),
						};
					}),
					textElement,
				],
				captureUpdate: "IMMEDIATELY",
			});
		},
		[getAction],
	);

	const getMeasurementText = useCallback(
		(pixelLength: number) => {
			if (
				cacheSettings?.measurementScalePixels &&
				cacheSettings.measurementScaleValue
			) {
				const value =
					(pixelLength / cacheSettings.measurementScalePixels) *
					cacheSettings.measurementScaleValue;
				return `${formatMeasurementValue(value)} ${
					cacheSettings.measurementScaleUnit
				}`;
			}

			return `${formatMeasurementValue(pixelLength)} px`;
		},
		[cacheSettings],
	);

	const handleNewArrow = useCallback(() => {
		const action = getAction();
		const sceneElements = action?.getExcalidrawAPI()?.getSceneElements();
		if (!sceneElements) {
			return;
		}

		const newArrowElement = sceneElements.find((item) => {
			return item.type === "arrow" && !arrowElementIdsRef.current.has(item.id);
		}) as ExcalidrawLinearElement | undefined;

		if (!newArrowElement || isMeasurementTextElement(newArrowElement)) {
			return;
		}

		arrowElementIdsRef.current.add(newArrowElement.id);

		const points = getArrowAbsolutePoints(newArrowElement);
		const pixelLength = getPolylineDistance(points);
		if (pixelLength < 3) {
			return;
		}

		const middlePoint = getPolylineMiddlePoint(points);
		if (drawStateRef.current === DrawState.DimensionCalibrate) {
			pendingCalibrationRef.current = {
				arrowElement: newArrowElement,
				pixelLength,
				middlePoint,
			};
			form.setFieldsValue({
				value: cacheSettings?.measurementScaleValue || undefined,
				unit: cacheSettings?.measurementScaleUnit || "px",
			});
			setCalibrationOpen(true);
			return;
		}

		appendMeasurementText(
			newArrowElement,
			getMeasurementText(pixelLength),
			middlePoint,
		);
	}, [
		appendMeasurementText,
		cacheSettings,
		drawStateRef,
		form,
		getAction,
		getMeasurementText,
	]);

	useStateSubscriber(
		ExcalidrawEventPublisher,
		useCallback(
			(params: ExcalidrawEventParams | undefined) => {
				if (params?.event === "onDraw") {
					resetArrowElementIds();
				}

				if (!enableRef.current || params?.event !== "onPointerUp") {
					return;
				}

				setTimeout(handleNewArrow, 0);
			},
			[enableRef, handleNewArrow, resetArrowElementIds],
		),
	);

	return (
		<Modal
			open={calibrationOpen}
			title={intl.formatMessage({ id: "draw.measurement.calibrate" })}
			okText={intl.formatMessage({ id: "draw.confirm" })}
			cancelText={intl.formatMessage({ id: "draw.cancelTool" })}
			onCancel={() => {
				setCalibrationOpen(false);
				pendingCalibrationRef.current = undefined;
			}}
			onOk={async () => {
				const values = await form.validateFields();
				const pendingCalibration = pendingCalibrationRef.current;
				if (!pendingCalibration) {
					return;
				}

				updateAppSettings(
					AppSettingsGroup.Cache,
					{
						measurementScalePixels: pendingCalibration.pixelLength,
						measurementScaleValue: values.value,
						measurementScaleUnit: values.unit.trim() || "px",
					},
					true,
					true,
					false,
					true,
					false,
				);

				appendMeasurementText(
					pendingCalibration.arrowElement,
					`${formatMeasurementValue(values.value)} ${values.unit.trim() || "px"}`,
					pendingCalibration.middlePoint,
				);
				setCalibrationOpen(false);
				pendingCalibrationRef.current = undefined;
			}}
		>
			<Form form={form} layout="vertical">
				<Form.Item>
					{intl.formatMessage(
						{ id: "draw.measurement.calibrateTip" },
						{
							pixels: formatMeasurementValue(
								pendingCalibrationRef.current?.pixelLength ?? 0,
							),
						},
					)}
				</Form.Item>
				<Form.Item
					name="value"
					label={intl.formatMessage({ id: "draw.measurement.realLength" })}
					rules={[{ required: true }]}
				>
					<InputNumber min={0.0001} style={{ width: "100%" }} />
				</Form.Item>
				<Form.Item
					name="unit"
					label={intl.formatMessage({ id: "draw.measurement.unit" })}
					rules={[{ required: true }]}
				>
					<Input />
				</Form.Item>
				<Form.Item>
					{intl.formatMessage(
						{ id: "draw.measurement.currentScale" },
						{ scale: measurementScaleText },
					)}
				</Form.Item>
			</Form>
		</Modal>
	);
};
