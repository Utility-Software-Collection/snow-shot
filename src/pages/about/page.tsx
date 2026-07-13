"use client";

import {
	BugOutlined,
	CloudDownloadOutlined,
	GithubOutlined,
	HistoryOutlined,
	ReloadOutlined,
	RightOutlined,
} from "@ant-design/icons";
import { getVersion } from "@tauri-apps/api/app";
import { fetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	Alert,
	Badge,
	Button,
	Descriptions,
	Divider,
	List,
	Space,
	Tag,
	Tooltip,
	Typography,
	theme,
} from "antd";
import { compare } from "compare-versions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { getCommitSha } from "@/commands/core";
import { getLatestVersion } from "@/components/checkVersion";

const { Title, Paragraph, Text } = Typography;
const forkAuthorUrl = "https://github.com/xiaofeiTM233";
const originalRepositoryUrl = "https://github.com/mg-chao/snow-shot";
const forkRepositoryUrl = "https://github.com/xiaofeiTM233/snow-shot";
const githubIssuesUrl = "https://github.com/xiaofeiTM233/snow-shot/issues";
const forkReleasesUrl = "https://github.com/xiaofeiTM233/snow-shot/releases";
const forkLatestReleaseUrl = `${forkReleasesUrl}/latest`;
const forkLatestReleaseApiUrl =
	"https://api.github.com/repos/xiaofeiTM233/snow-shot/releases/latest";

type GithubRelease = {
	html_url: string;
	name?: string;
	published_at?: string;
	tag_name: string;
};

const normalizeVersion = (value: string) => {
	return value.trim().replace(/^v/i, "");
};

export const AboutPage = () => {
	const { token } = theme.useToken();
	const intl = useIntl();
	const [version, setVersion] = useState("0.1.3");
	const [latestVersion, setLatestVersion] = useState<string>();
	const [commitSha, setCommitSha] = useState<string>("");
	const [forkLatestRelease, setForkLatestRelease] = useState<GithubRelease>();
	const [releaseCheckLoading, setReleaseCheckLoading] = useState(false);
	const [releaseCheckError, setReleaseCheckError] = useState(false);

	const inited = useRef(false);
	const init = useCallback(async () => {
		if (inited.current) {
			return;
		}
		inited.current = true;

		const version = await getVersion();
		setVersion(version);

		const latestVersion = await getLatestVersion();
		if (latestVersion) {
			setLatestVersion(latestVersion);
		}

		const commitSha = await getCommitSha();
		setCommitSha(commitSha);
	}, []);

	useEffect(() => {
		init();
	}, [init]);

	const hasNewVersion = useMemo(() => {
		return latestVersion !== undefined && compare(latestVersion, version, ">");
	}, [latestVersion, version]);

	const hasForkNewRelease = useMemo(() => {
		if (!forkLatestRelease?.tag_name) {
			return false;
		}

		try {
			return compare(
				normalizeVersion(forkLatestRelease.tag_name),
				normalizeVersion(version),
				">",
			);
		} catch {
			return false;
		}
	}, [forkLatestRelease, version]);

	const checkForkRelease = useCallback(async () => {
		setReleaseCheckLoading(true);
		setReleaseCheckError(false);
		try {
			const response = await fetch(forkLatestReleaseApiUrl, {
				headers: {
					Accept: "application/vnd.github+json",
				},
			});
			if (!response.ok) {
				setReleaseCheckError(true);
				return;
			}

			setForkLatestRelease((await response.json()) as GithubRelease);
		} catch {
			setReleaseCheckError(true);
		} finally {
			setReleaseCheckLoading(false);
		}
	}, []);

	const forkActionItems = useMemo(
		() => [
			{
				key: "repo",
				icon: <GithubOutlined />,
				title: intl.formatMessage({ id: "about.forkActions.repository" }),
				url: forkRepositoryUrl,
			},
			{
				key: "issue",
				icon: <BugOutlined />,
				title: intl.formatMessage({ id: "about.forkActions.issue" }),
				url: githubIssuesUrl,
			},
			{
				key: "release",
				icon: <CloudDownloadOutlined />,
				title: intl.formatMessage({ id: "about.forkActions.release" }),
				url: forkReleasesUrl,
			},
		],
		[intl],
	);

	const forkChangelogItems = useMemo(
		() => [
			intl.formatMessage({ id: "about.forkChangelog.item.redact" }),
			intl.formatMessage({ id: "about.forkChangelog.item.toolbarPreview" }),
			intl.formatMessage({ id: "about.forkChangelog.item.about" }),
		],
		[intl],
	);

	return (
		<div
			style={{
				margin: `${token.marginLG}px 0`,
				minHeight: "100vh",
			}}
		>
			{/* 头部信息 */}
			<div style={{ textAlign: "center", marginBottom: token.marginLG }}>
				<div style={{ marginBottom: -12 }}>
					<img
						src={"/images/app-icon.png"}
						alt="Snow Shot"
						width={100}
						height={100}
					/>
				</div>

				<Title level={2} style={{ marginTop: token.marginSM }}>
					<Badge
						count={
							hasNewVersion
								? intl.formatMessage({ id: "about.newVersion" })
								: undefined
						}
						style={{ display: "block", cursor: "pointer" }}
						size="small"
						onClick={() => openUrl("https://snowshot.top/")}
					>
						<div
							style={{
								fontSize: token.fontSizeHeading2,
								marginTop: token.marginXS,
							}}
						>
							<span style={{ color: "var(--snow-shot-purple-color)" }}>
								Snow{" "}
							</span>
							<span>Shot</span>
						</div>
					</Badge>
				</Title>
				<div>
					<Text type="secondary">
						{intl.formatMessage({ id: "about.subtitle" })}
					</Text>
				</div>
				<div style={{ marginTop: token.margin }}>
					<Tooltip title={commitSha ? `Commit SHA: ${commitSha}` : undefined}>
						<Tag color="blue">
							<a
								style={{ color: token.colorLink }}
								onClick={() => openUrl("https://snowshot.top/")}
							>
								{intl.formatMessage({ id: "about.version" })} {version}
							</a>
						</Tag>
					</Tooltip>
					<Tag color="green">
						<a
							style={{ color: token.colorLink }}
							onClick={() => openUrl("https://github.com/mg-chao")}
						>
							{intl.formatMessage({ id: "about.author" })}
						</a>
					</Tag>
					<Tag color="purple">
						<a
							style={{ color: token.colorLink }}
							onClick={() => openUrl(forkAuthorUrl)}
						>
							{intl.formatMessage({ id: "about.forkAuthor" })}
						</a>
					</Tag>
				</div>
			</div>

			<Divider />

			{/* 分支信息 */}
			<div style={{ marginBottom: token.marginLG }}>
				<Title level={3}>
					{intl.formatMessage({ id: "about.branchInfo.title" })}
				</Title>
				<Descriptions
					bordered
					size="small"
					column={1}
					items={[
						{
							key: "currentVersion",
							label: intl.formatMessage({
								id: "about.branchInfo.currentVersion",
							}),
							children: version,
						},
						{
							key: "latestVersion",
							label: intl.formatMessage({
								id: "about.branchInfo.latestVersion",
							}),
							children:
								latestVersion ??
								intl.formatMessage({
									id: "about.branchInfo.latestVersion.empty",
								}),
						},
						{
							key: "commitSha",
							label: intl.formatMessage({ id: "about.branchInfo.commitSha" }),
							children: commitSha ? (
								<a
									onClick={() =>
										openUrl(`${forkRepositoryUrl}/commit/${commitSha}`)
									}
								>
									{commitSha.slice(0, 12)}
								</a>
							) : (
								intl.formatMessage({ id: "about.branchInfo.unknown" })
							),
						},
						{
							key: "originalRepository",
							label: intl.formatMessage({
								id: "about.branchInfo.originalRepository",
							}),
							children: (
								<a onClick={() => openUrl(originalRepositoryUrl)}>
									{originalRepositoryUrl}
								</a>
							),
						},
						{
							key: "forkRepository",
							label: intl.formatMessage({
								id: "about.branchInfo.forkRepository",
							}),
							children: (
								<a onClick={() => openUrl(forkRepositoryUrl)}>
									{forkRepositoryUrl}
								</a>
							),
						},
					]}
				/>
			</div>

			<Divider />

			{/* 第三方分支入口 */}
			<div style={{ marginBottom: token.marginLG }}>
				<Title level={3}>
					{intl.formatMessage({ id: "about.forkActions.title" })}
				</Title>
				<Space wrap style={{ width: "100%" }}>
					{forkActionItems.map((item) => (
						<Button
							key={item.key}
							icon={item.icon}
							onClick={() => openUrl(item.url)}
						>
							{item.title}
						</Button>
					))}
					<Button
						type="primary"
						icon={<ReloadOutlined />}
						loading={releaseCheckLoading}
						onClick={checkForkRelease}
					>
						{intl.formatMessage({ id: "about.forkActions.checkRelease" })}
					</Button>
				</Space>

				{forkLatestRelease && (
					<Alert
						style={{ marginTop: token.margin }}
						type={hasForkNewRelease ? "success" : "info"}
						showIcon
						message={intl.formatMessage(
							{
								id: hasForkNewRelease
									? "about.forkActions.releaseCheck.new"
									: "about.forkActions.releaseCheck.latest",
							},
							{
								version: forkLatestRelease.tag_name,
							},
						)}
						description={
							<Space split={<Divider type="vertical" />}>
								<Text type="secondary">
									{forkLatestRelease.name ?? forkLatestRelease.tag_name}
								</Text>
								<a
									onClick={() =>
										openUrl(forkLatestRelease.html_url || forkLatestReleaseUrl)
									}
								>
									{intl.formatMessage({
										id: "about.forkActions.releaseCheck.open",
									})}
								</a>
							</Space>
						}
					/>
				)}

				{releaseCheckError && (
					<Alert
						style={{ marginTop: token.margin }}
						type="warning"
						showIcon
						message={intl.formatMessage({
							id: "about.forkActions.releaseCheck.failed",
						})}
						action={
							<Button
								size="small"
								onClick={() => openUrl(forkLatestReleaseUrl)}
							>
								{intl.formatMessage({
									id: "about.forkActions.releaseCheck.open",
								})}
							</Button>
						}
					/>
				)}
			</div>

			<Divider />

			{/* 第三方分支更新日志 */}
			<div style={{ marginBottom: token.marginLG }}>
				<Title level={3}>
					<Space>
						<HistoryOutlined />
						{intl.formatMessage({ id: "about.forkChangelog.title" })}
					</Space>
				</Title>
				<List
					size="small"
					dataSource={forkChangelogItems}
					renderItem={(item) => <List.Item>{item}</List.Item>}
				/>
			</div>

			<Divider />

			{/* 开源协议 */}
			<div style={{ marginBottom: token.marginLG }}>
				<Title level={3}>
					{intl.formatMessage({ id: "about.license.title" })}
				</Title>
				<Paragraph>
					{intl.formatMessage({ id: "about.license.description" })}
				</Paragraph>
				<ul>
					<li>
						<strong>
							{intl.formatMessage({ id: "about.license.nonCommercial" })}
						</strong>
						<a
							onClick={() =>
								openUrl("https://www.apache.org/licenses/LICENSE-2.0")
							}
						>
							{intl.formatMessage({ id: "about.license.nonCommercialType" })}
						</a>
					</li>
					<li>
						<strong>
							{intl.formatMessage({ id: "about.license.commercial" })}
						</strong>
						<a
							onClick={() =>
								openUrl("https://www.gnu.org/licenses/gpl-3.0.html")
							}
						>
							{intl.formatMessage({ id: "about.license.commercialType" })}
						</a>
					</li>
				</ul>
			</div>

			{/* 联系方式 */}
			<div style={{ marginBottom: token.marginLG }}>
				<Title level={3}>
					{intl.formatMessage({ id: "about.contact.title" })}
				</Title>
				<Button
					type="primary"
					size="large"
					onClick={() => openUrl(githubIssuesUrl)}
					block
					style={{
						height: "auto",
						padding: `${token.padding}px ${token.paddingLG}px`,
						borderRadius: token.borderRadiusLG,
						boxShadow: token.boxShadowSecondary,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: token.margin,
							width: "100%",
							textAlign: "left",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: token.marginSM,
								minWidth: 0,
							}}
						>
							<GithubOutlined style={{ fontSize: token.fontSizeHeading3 }} />
							<div style={{ minWidth: 0 }}>
								<div style={{ fontWeight: 600 }}>
									{intl.formatMessage({ id: "about.contact.github" })}
								</div>
								<div
									style={{
										fontSize: token.fontSizeSM,
										opacity: 0.82,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{githubIssuesUrl}
								</div>
							</div>
						</div>
						<RightOutlined />
					</div>
				</Button>
			</div>
		</div>
	);
};
