import { type DependencyList, useEffect, useState } from "react";
import {
	type HotkeyCallback,
	type Keys,
	type Options,
	useHotkeys,
	useHotkeysContext,
} from "react-hotkeys-hook";
import { HotkeysScope } from "@/types/core/appHotKeys";

export const useHotkeysApp = (
	keys: Keys,
	callback: HotkeyCallback,
	options?: Options | DependencyList,
	dependencies?: DependencyList,
) => {
	const { activeScopes } = useHotkeysContext();

	const [enable, setEnable] = useState(true);

	useEffect(() => {
		if (options && "scopes" in options && typeof options.scopes === "string") {
			setEnable(
				activeScopes.includes(options.scopes) ||
					activeScopes.includes(HotkeysScope.All),
			);
		}
	}, [activeScopes, options]);

	return useHotkeys(
		keys,
		callback,
		{
			...options,
			enabled:
				enable && (options && "enabled" in options ? options.enabled : true),
		},
		dependencies,
	);
};
