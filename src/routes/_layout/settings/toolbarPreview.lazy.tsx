import { createLazyFileRoute } from "@tanstack/react-router";
import { ToolbarPreviewSettingsPage } from "@/pages/settings/toolbarPreview/page";

export const Route = createLazyFileRoute("/_layout/settings/toolbarPreview")({
	component: ToolbarPreviewSettingsComponent,
});

function ToolbarPreviewSettingsComponent() {
	return <ToolbarPreviewSettingsPage />;
}
