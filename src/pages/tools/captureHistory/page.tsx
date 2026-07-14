"use client";

import {
	DeleteOutlined,
	ExportOutlined,
	ReloadOutlined,
} from "@ant-design/icons";
import { type ActionType, ProList } from "@ant-design/pro-components";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join as joinPath } from "@tauri-apps/api/path";
import * as dialog from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { Button, Popconfirm, Space, Tag, theme } from "antd";
import dayjs from "dayjs";
import type { Key } from "react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { copyFile, writeFile } from "@/commands/file";
import { EventListenerContext } from "@/components/eventListener";
import { AntdContext } from "@/contexts/antdContext";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { executeScreenshot } from "@/functions/screenshot";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { useStateRef } from "@/hooks/useStateRef";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import {
	type CaptureHistoryItem,
	CaptureHistorySource,
} from "@/utils/appStore";
import {
	CaptureHistory,
	getCaptureHistoryImageAbsPath,
} from "@/utils/captureHistory";
import { appWarn } from "@/utils/log";
import { ScreenshotType } from "@/utils/types";
import { CaptureHistoryItemActions } from "./components/captureHistoryItemActions";
import { CaptureHistoryItemPreview } from "./components/captureHistoryItemPreview";
import type { CaptureHistoryRecordItem } from "./extra";

const textEncoder = new TextEncoder();

const crc32Table = new Uint32Array(256);
for (let i = 0; i < crc32Table.length; i++) {
	let crc = i;
	for (let j = 0; j < 8; j++) {
		crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	crc32Table[i] = crc >>> 0;
}

const getCrc32 = (data: Uint8Array) => {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
};

const getDosDateTime = (timestamp: number) => {
	const date = new Date(timestamp || Date.now());
	const year = Math.max(1980, Math.min(date.getFullYear(), 2107));
	return {
		dosDate:
			((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
		dosTime:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			Math.floor(date.getSeconds() / 2),
	};
};

const writeUint16 = (dataView: DataView, offset: number, value: number) => {
	dataView.setUint16(offset, value, true);
};

const writeUint32 = (dataView: DataView, offset: number, value: number) => {
	dataView.setUint32(offset, value >>> 0, true);
};

const getUniqueZipEntryName = (fileName: string, usedNames: Set<string>) => {
	const safeFileName = fileName.replace(/[\\/]/g, "_") || "capture.png";
	let entryName = safeFileName;
	let index = 1;
	const dotIndex = safeFileName.lastIndexOf(".");
	const baseName =
		dotIndex > 0 ? safeFileName.slice(0, dotIndex) : safeFileName;
	const extension = dotIndex > 0 ? safeFileName.slice(dotIndex) : "";
	while (usedNames.has(entryName)) {
		entryName = `${baseName}_${index}${extension}`;
		index++;
	}
	usedNames.add(entryName);
	return entryName;
};

const concatUint8Arrays = (arrays: Uint8Array[]) => {
	const totalLength = arrays.reduce((sum, item) => sum + item.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const item of arrays) {
		result.set(item, offset);
		offset += item.length;
	}
	return result;
};

const createZipArchive = (
	entries: { name: string; data: Uint8Array; timestamp: number }[],
) => {
	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];
	let localOffset = 0;

	for (const entry of entries) {
		const nameBytes = textEncoder.encode(entry.name);
		const crc32 = getCrc32(entry.data);
		const { dosDate, dosTime } = getDosDateTime(entry.timestamp);

		const localHeader = new Uint8Array(30 + nameBytes.length);
		const localHeaderView = new DataView(localHeader.buffer);
		writeUint32(localHeaderView, 0, 0x04034b50);
		writeUint16(localHeaderView, 4, 20);
		writeUint16(localHeaderView, 6, 0x0800);
		writeUint16(localHeaderView, 8, 0);
		writeUint16(localHeaderView, 10, dosTime);
		writeUint16(localHeaderView, 12, dosDate);
		writeUint32(localHeaderView, 14, crc32);
		writeUint32(localHeaderView, 18, entry.data.length);
		writeUint32(localHeaderView, 22, entry.data.length);
		writeUint16(localHeaderView, 26, nameBytes.length);
		writeUint16(localHeaderView, 28, 0);
		localHeader.set(nameBytes, 30);

		const centralHeader = new Uint8Array(46 + nameBytes.length);
		const centralHeaderView = new DataView(centralHeader.buffer);
		writeUint32(centralHeaderView, 0, 0x02014b50);
		writeUint16(centralHeaderView, 4, 20);
		writeUint16(centralHeaderView, 6, 20);
		writeUint16(centralHeaderView, 8, 0x0800);
		writeUint16(centralHeaderView, 10, 0);
		writeUint16(centralHeaderView, 12, dosTime);
		writeUint16(centralHeaderView, 14, dosDate);
		writeUint32(centralHeaderView, 16, crc32);
		writeUint32(centralHeaderView, 20, entry.data.length);
		writeUint32(centralHeaderView, 24, entry.data.length);
		writeUint16(centralHeaderView, 28, nameBytes.length);
		writeUint16(centralHeaderView, 30, 0);
		writeUint16(centralHeaderView, 32, 0);
		writeUint16(centralHeaderView, 34, 0);
		writeUint16(centralHeaderView, 36, 0);
		writeUint32(centralHeaderView, 38, 0);
		writeUint32(centralHeaderView, 42, localOffset);
		centralHeader.set(nameBytes, 46);

		localParts.push(localHeader, entry.data);
		centralParts.push(centralHeader);
		localOffset += localHeader.length + entry.data.length;
	}

	const centralDirectory = concatUint8Arrays(centralParts);
	const endHeader = new Uint8Array(22);
	const endHeaderView = new DataView(endHeader.buffer);
	writeUint32(endHeaderView, 0, 0x06054b50);
	writeUint16(endHeaderView, 4, 0);
	writeUint16(endHeaderView, 6, 0);
	writeUint16(endHeaderView, 8, entries.length);
	writeUint16(endHeaderView, 10, entries.length);
	writeUint32(endHeaderView, 12, centralDirectory.length);
	writeUint32(endHeaderView, 16, localOffset);
	writeUint16(endHeaderView, 20, 0);

	return concatUint8Arrays([...localParts, centralDirectory, endHeader]);
};

export const CaptureHistoryPage = () => {
	const intl = useIntl();
	const [loading, setLoading] = useState(true);
	const [dataSource, setDataSource, dataSourceRef] = useStateRef<
		CaptureHistoryItem[] | undefined
	>(undefined);
	const captureHistoryRef = useRef<CaptureHistory | undefined>(undefined);
	const { token } = theme.useToken();
	const { message, modal } = useContext(AntdContext);
	const actionRef = useRef<ActionType>(null);
	const [exportAllLoading, setExportAllLoading] = useState(false);

	const initedRef = useRef(false);
	const [getAppSettings] = useStateSubscriber(AppSettingsPublisher, undefined);
	const initDataSource = useCallback(
		async (appSettings: AppSettingsData) => {
			if (initedRef.current) {
				return;
			}
			initedRef.current = true;

			setLoading(true);

			captureHistoryRef.current = new CaptureHistory();
			await captureHistoryRef.current.init();
			const list = (await captureHistoryRef.current.getList(appSettings)).sort(
				(a, b) => b.create_ts - a.create_ts,
			);
			setDataSource(list);

			actionRef.current?.reload();
		},
		[setDataSource],
	);
	const reloadList = useCallback(async () => {
		initedRef.current = false;
		initDataSource(getAppSettings());
	}, [getAppSettings, initDataSource]);

	useAppSettingsLoad(initDataSource, false);

	const { addListener, removeListener } = useContext(EventListenerContext);
	useEffect(() => {
		const listenerId = addListener("on-capture-history-change", () => {
			reloadList();
		});
		return () => {
			removeListener(listenerId);
		};
	}, [addListener, reloadList, removeListener]);

	const getSourceDesc = useCallback(
		(source: CaptureHistorySource | undefined) => {
			switch (source) {
				case CaptureHistorySource.ScrollScreenshotCopy:
					return (
						<FormattedMessage id="tools.captureHistory.source.scrollScreenshotCopy" />
					);
				case CaptureHistorySource.ScrollScreenshotSave:
					return (
						<FormattedMessage id="tools.captureHistory.source.scrollScreenshotSave" />
					);
				case CaptureHistorySource.ScrollScreenshotFixed:
					return (
						<FormattedMessage id="tools.captureHistory.source.scrollScreenshotFixed" />
					);
				case CaptureHistorySource.Copy:
					return <FormattedMessage id="tools.captureHistory.source.copy" />;
				case CaptureHistorySource.Save:
					return <FormattedMessage id="tools.captureHistory.source.save" />;
				case CaptureHistorySource.Fixed:
					return <FormattedMessage id="tools.captureHistory.source.fixed" />;
				case CaptureHistorySource.FullScreen:
					return (
						<FormattedMessage id="tools.captureHistory.source.fullScreen" />
					);
			}

			return <FormattedMessage id="tools.captureHistory.source.unknown" />;
		},
		[],
	);

	const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

	const currentFilterDataRef = useRef<CaptureHistoryRecordItem[]>([]);
	const exportCaptureHistoryToDirectory = useCallback(
		async (list: CaptureHistoryItem[], exportDirectory: string) => {
			await Promise.all(
				list.map(async (item) => {
					const fileName = item.capture_result_file_name ?? item.file_name;
					await copyFile(
						await getCaptureHistoryImageAbsPath(fileName),
						await joinPath(exportDirectory, fileName),
					);
				}),
			);
		},
		[],
	);
	const exportCaptureHistoryToZip = useCallback(
		async (list: CaptureHistoryItem[], zipFilePath: string) => {
			const usedNames = new Set<string>();
			const entries = await Promise.all(
				list.map(async (item) => {
					const fileName = item.capture_result_file_name ?? item.file_name;
					const fileData = await readFile(
						await getCaptureHistoryImageAbsPath(fileName),
					);
					return {
						name: getUniqueZipEntryName(fileName, usedNames),
						data: fileData,
						timestamp: item.create_ts,
					};
				}),
			);
			await writeFile(zipFilePath, createZipArchive(entries));
		},
		[],
	);
	const handleExportAll = useCallback(async () => {
		const list = dataSourceRef.current ?? [];
		if (list.length === 0) {
			message.info(
				intl.formatMessage({ id: "tools.captureHistory.exportAll.empty" }),
			);
			return;
		}

		const exportAsZip =
			getAppSettings()[AppSettingsGroup.SystemScreenshot]
				.exportCaptureHistoryAsZip;

		setExportAllLoading(true);
		try {
			if (exportAsZip) {
				const exportFile = await dialog.save({
					title: intl.formatMessage({
						id: "tools.captureHistory.exportAll.selectZipFile",
					}),
					defaultPath: `SnowShot_CaptureHistory_${dayjs().format(
						"YYYYMMDD_HHmmss",
					)}.zip`,
					filters: [
						{
							name: "ZIP",
							extensions: ["zip"],
						},
					],
				});
				if (!exportFile) {
					return;
				}

				await exportCaptureHistoryToZip(
					list,
					exportFile.toLowerCase().endsWith(".zip")
						? exportFile
						: `${exportFile}.zip`,
				);
			} else {
				const exportDirectory = await dialog.open({
					directory: true,
					multiple: false,
					title: intl.formatMessage({
						id: "tools.captureHistory.exportAll.selectDirectory",
					}),
				});
				if (!exportDirectory || Array.isArray(exportDirectory)) {
					return;
				}

				await exportCaptureHistoryToDirectory(list, exportDirectory);
			}
			message.success(
				intl.formatMessage(
					{ id: "tools.captureHistory.exportAll.success" },
					{ count: list.length },
				),
			);
		} catch (error) {
			appWarn("[CaptureHistoryPage] export all failed", error);
			message.error(
				intl.formatMessage({ id: "tools.captureHistory.exportAll.failed" }),
			);
		} finally {
			setExportAllLoading(false);
		}
	}, [
		dataSourceRef,
		exportCaptureHistoryToDirectory,
		exportCaptureHistoryToZip,
		getAppSettings,
		intl,
		message,
	]);
	const handleClearAll = useCallback(async () => {
		const confirmed = await modal.confirmWithStatus({
			title: intl.formatMessage({
				id: "tools.captureHistory.clearAll.secondConfirm",
			}),
			content: intl.formatMessage({
				id: "tools.captureHistory.clearAll.secondConfirm.content",
			}),
			okText: intl.formatMessage({ id: "tools.captureHistory.clearAll" }),
			okButtonProps: {
				danger: true,
			},
		});
		if (!confirmed) {
			return;
		}

		await captureHistoryRef.current?.clearAll();
		reloadList();
		setSelectedRowKeys([]);
	}, [intl, modal, reloadList]);

	const tableAlertOptionRender = useCallback(() => {
		return (
			<Space>
				<Popconfirm
					title={
						<FormattedMessage id="tools.captureHistory.deleteSelected.confirm" />
					}
					onConfirm={async () => {
						await Promise.all(
							selectedRowKeys.map((key) => {
								if (typeof key !== "string") {
									appWarn(
										"[CaptureHistoryPage] selectedRowKeys is not a string",
										key,
									);
									return Promise.resolve();
								}

								return captureHistoryRef.current?.delete(key);
							}),
						);

						reloadList();
						setSelectedRowKeys([]);
					}}
				>
					<a key="delete" style={{ color: token.colorError }}>
						<FormattedMessage id="tools.captureHistory.delete" />
					</a>
				</Popconfirm>
				<a
					key="selectAll"
					onClick={() =>
						setSelectedRowKeys((prev) => {
							const set = new Set(prev);
							currentFilterDataRef.current.forEach((item) => {
								set.add(item.id);
							});
							return Array.from(set);
						})
					}
				>
					<FormattedMessage id="tools.captureHistory.selectAll" />
				</a>
				<a key="clearSelection" onClick={() => setSelectedRowKeys([])}>
					<FormattedMessage id="tools.captureHistory.clearSelection" />
				</a>
			</Space>
		);
	}, [selectedRowKeys, token, reloadList]);

	return (
		<>
			<ProList<CaptureHistoryRecordItem>
				rowSelection={{
					selectedRowKeys,
					onChange: (keys: Key[]) => setSelectedRowKeys(keys),
					preserveSelectedRowKeys: true,
					hideSelectAll: false,
				}}
				tableAlertOptionRender={tableAlertOptionRender}
				itemLayout="vertical"
				rowKey="id"
				headerTitle={
					<>
						<FormattedMessage id="tools.captureHistory.count" />
						{`: ${dataSource?.length ?? "-"}`}
					</>
				}
				loading={loading}
				className="capture-history-list"
				actionRef={actionRef}
				toolBarRender={() => [
					<Button
						key="exportAll"
						type="text"
						icon={<ExportOutlined />}
						loading={exportAllLoading}
						disabled={!dataSource?.length}
						onClick={handleExportAll}
					>
						<FormattedMessage id="tools.captureHistory.exportAll" />
					</Button>,
					<div key="clearAll">
						<Popconfirm
							key="clearAll"
							title={
								<FormattedMessage id="tools.captureHistory.clearAll.confirm" />
							}
							onConfirm={handleClearAll}
						>
							<Button
								type="text"
								icon={<DeleteOutlined />}
								disabled={!dataSource?.length}
								style={{ color: token.colorError }}
								title={intl.formatMessage({
									id: "tools.captureHistory.clearAll",
								})}
							>
								<FormattedMessage id="tools.captureHistory.clearAll" />
							</Button>
						</Popconfirm>
					</div>,
					<Button
						key="reload"
						type="text"
						loading={loading}
						onClick={() => {
							reloadList();
						}}
						icon={<ReloadOutlined />}
					/>,
				]}
				request={async (params) => {
					setLoading(true);

					if (!dataSourceRef.current) {
						currentFilterDataRef.current = [];
						return {
							data: [],
							success: false,
							pageSize: 10,
							total: 0,
						};
					}

					const pageSize = params.pageSize ?? 10;
					const current = params.current ?? 1;
					const startIndex = (current - 1) * pageSize;

					let startTs: number | undefined;
					let endTs: number | undefined;
					if (
						"create_ts" in params &&
						Array.isArray(params.create_ts) &&
						params.create_ts.length === 2
					) {
						startTs = dayjs(
							params.create_ts[0],
							"YYYY-MM-DD HH:mm:ss",
						).valueOf();
						endTs = dayjs(params.create_ts[1], "YYYY-MM-DD HH:mm:ss").valueOf();
					}

					const filterData = dataSourceRef.current.filter((item) => {
						let isMatch = true;
						if (startTs && endTs) {
							isMatch &&= item.create_ts >= startTs && item.create_ts <= endTs;
						}
						if (params.source) {
							isMatch &&= item.source === params.source;
						}
						return isMatch;
					});
					const data = await Promise.all(
						filterData
							.slice(startIndex, startIndex + pageSize)
							.map(async (item, index) => {
								const file_path = await getCaptureHistoryImageAbsPath(
									item.file_name,
								);
								const capture_result_file_path = item.capture_result_file_name
									? await getCaptureHistoryImageAbsPath(
											item.capture_result_file_name,
										)
									: undefined;
								return {
									...item,
									serial_number: startIndex + index + 1,
									file_path,
									file_url: convertFileSrc(file_path),
									capture_result_file_path,
									capture_result_file_url: capture_result_file_path
										? convertFileSrc(capture_result_file_path)
										: undefined,
								};
							}),
					);

					setLoading(false);

					currentFilterDataRef.current = data;
					return {
						data,
						success: true,
						pageSize: pageSize,
						total: filterData.length,
					};
				}}
				pagination={{
					defaultPageSize: 20,
					showSizeChanger: true,
				}}
				search={{
					filterType: "light",
				}}
				metas={{
					source: {
						search: true,
						dataIndex: "source",
						valueType: "select",
						title: <FormattedMessage id="tools.captureHistory.source" />,
						valueEnum: {
							[CaptureHistorySource.Copy]: (
								<FormattedMessage id="tools.captureHistory.source.copy" />
							),
							[CaptureHistorySource.Save]: (
								<FormattedMessage id="tools.captureHistory.source.save" />
							),
							[CaptureHistorySource.Fixed]: (
								<FormattedMessage id="tools.captureHistory.source.fixed" />
							),
							[CaptureHistorySource.FullScreen]: (
								<FormattedMessage id="tools.captureHistory.source.fullScreen" />
							),
							[CaptureHistorySource.ScrollScreenshotCopy]: (
								<FormattedMessage id="tools.captureHistory.source.scrollScreenshotCopy" />
							),
							[CaptureHistorySource.ScrollScreenshotSave]: (
								<FormattedMessage id="tools.captureHistory.source.scrollScreenshotSave" />
							),
							[CaptureHistorySource.ScrollScreenshotFixed]: (
								<FormattedMessage id="tools.captureHistory.source.scrollScreenshotFixed" />
							),
						},
					},
					title: {
						title: <FormattedMessage id="tools.captureHistory.date" />,
						render: (_, item) => {
							return (
								<div
									onClick={() => {
										executeScreenshot(
											ScreenshotType.SwitchCaptureHistory,
											undefined,
											item.id,
										);
									}}
								>
									{`${item.serial_number}. `}
									<FormattedMessage id="tools.captureHistory.date" />
									{`: ${dayjs(item.create_ts).format("YYYY-MM-DD HH:mm:ss")}`}
								</div>
							);
						},
						search: true,
						dataIndex: "create_ts",
						valueType: "dateTimeRange",
					},
					description: {
						search: false,
						render: (_, item) => {
							const { selected_rect } = item;

							return (
								<>
									<Tag>
										<FormattedMessage id="tools.captureHistory.position" />
										{`: ${selected_rect.min_x} , ${selected_rect.min_y}`}
									</Tag>
									<Tag>
										<FormattedMessage id="tools.captureHistory.size" />
										{`: ${selected_rect.max_x - selected_rect.min_x} x ${selected_rect.max_y - selected_rect.min_y}`}
									</Tag>
									<Tag>
										<FormattedMessage id="tools.captureHistory.drawElements" />
										{`: ${item.excalidraw_elements?.length ?? 0}`}
									</Tag>
									<Tag>
										<FormattedMessage id="tools.captureHistory.source" />
										{`: `}
										{getSourceDesc(item.source)}
									</Tag>
								</>
							);
						},
					},
					actions: {
						search: false,
						cardActionProps: "extra",
						render: (_, item: CaptureHistoryRecordItem) => {
							return (
								<CaptureHistoryItemActions
									item={item}
									reloadList={reloadList}
									captureHistoryRef={captureHistoryRef}
								/>
							);
						},
					},
					extra: {
						search: false,
						render: (_: unknown, item: CaptureHistoryRecordItem) => {
							return <CaptureHistoryItemPreview item={item} />;
						},
					},
				}}
			/>

			<style jsx>{`
                :global(.capture-history-list .ant-pro-card-body) {
                    padding-inline: 0 !important;
                    padding-block: 0 !important;
                }
            `}</style>
		</>
	);
};
