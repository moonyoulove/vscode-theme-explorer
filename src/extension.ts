import pathlib from "node:path";
import * as vscode from "vscode";
import yaml from "yaml";

class Node extends vscode.TreeItem {
    children: this[] = [];
    parent: this | null = null;

    addChild(element: this) {
        this.children.push(element);
        element.parent = this;
    }

    removeAllChild() {
        this.children.forEach((node) => node.parent = null);
        this.children = [];
    }

    isIgnored() {
        return this.contextValue === "ignored";
    }

    isChecked() {
        return this.checkboxState === vscode.TreeItemCheckboxState.Checked;
    }
}

abstract class Tree<T extends Node> implements vscode.TreeDataProvider<T> {
    didChangeTreeDataEventEmitter: vscode.EventEmitter<T | null> = new vscode.EventEmitter<T | null>();
    onDidChangeTreeData: vscode.Event<T | null> = this.didChangeTreeDataEventEmitter.event;
    abstract root: T;
    view: vscode.TreeView<T> | null = null;
    private _needsScroll: boolean = false;

    getTreeItem(element: T) {
        return element;
    }

    getChildren(element?: T): T[] {
        return element ? element.children : this.root.children;
    }

    refresh() {
        this.root.removeAllChild();
        this.makeTreeData();
        this.didChangeTreeDataEventEmitter.fire(null);
        if (this.isNeedsScroll()) {
            this._needsScroll = false;
            this.scrollToCurrent();
        }
    }

    isNeedsScroll() {
        return this._needsScroll;
    }

    needsScroll() {
        this._needsScroll = true;
    }

    abstract makeTreeData(): void;

    getParent(element: T): vscode.ProviderResult<T> {
        return element.parent;
    }

    findCheckedItem(): T | undefined {
        return this.root.children.find((node) => node.isChecked());
    }

    scrollToCurrent() {
        const node = this.findCheckedItem();
        if (node) {
            this.scrollTo(node);
        }
    }

    scrollTo(node: T) {
        if (this.view) {
            this.view.reveal(node, { focus: false });
        }
    }

    getRandomItem(): T | undefined {
        const checked = this.findCheckedItem();
        const filtered = this.root.children.filter((node) => !node.isIgnored() && node !== checked);
        const index = Math.floor(Math.random() * filtered.length);
        return filtered[index];
    }

    abstract setConfig(value: T, config: vscode.WorkspaceConfiguration, showError: boolean): void;

    setView(view: vscode.TreeView<T>) {
        this.view = view;
    }
}

class Font extends Node {
    name = "";
    checkboxState = vscode.TreeItemCheckboxState.Unchecked;
    command: vscode.Command | undefined = {
        title: "",
        command: "theme-explorer.clickFontItem",
        arguments: [this],
    };

    constructor(name: string, ignored: boolean = false, checked: boolean = false) {
        super(name);
        this.name = name;
        this.iconPath = ignored ? new vscode.ThemeIcon("eye-closed") : "none";
        this.contextValue = ignored ? "ignored" : "";
        this.checkboxState = checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    }

    static toString(fonts: string[]): string {
        return fonts.map((font) => font.match(/\s/) ? `'${font}'` : font).join(", ");
    }

    static toArray(font: string): string[] {
        return yaml.parse("[" + font + "]");
    }
}

class FontTree extends Tree<Font> implements vscode.TreeDragAndDropController<Font> {
    root: Font = new Font("");
    dropMimeTypes: string[] = ["application/vnd.code.tree.theme-explorer.font"];
    dragMimeTypes: string[] = ["application/vnd.code.tree.theme-explorer.font"];

    makeTreeData() {
        const config = vscode.workspace.getConfiguration();
        const fonts: string[] = Font.toArray(config.get("editor.fontFamily", ""));
        const ignoredFonts: string[] = config.get("theme-explorer.ignoreFonts", []);
        const currentFont = fonts[0];
        const hasHidden = fonts.slice(1).includes(fonts[0]);
        fonts.slice(hasHidden ? 1 : 0).forEach((font) => {
            const ignored = ignoredFonts.includes(font);
            const checked = currentFont === font;
            this.root.addChild(new Font(font, ignored, checked));
        });
    }

    handleDrag(source: Font[], dataTransfer: vscode.DataTransfer) {
        const transferItem = new vscode.DataTransferItem(source[0].name);
        dataTransfer.set("application/vnd.code.tree.theme-explorer.font", transferItem);
    }

    handleDrop(target: Font, dataTransfer: vscode.DataTransfer) {
        const transferItem = dataTransfer.get("application/vnd.code.tree.theme-explorer.font");
        if (transferItem) {
            const sourceName: string = transferItem.value;
            const config = vscode.workspace.getConfiguration();
            const fonts: string[] = Font.toArray(config.get("editor.fontFamily", ""));
            const sourceIndex = fonts.lastIndexOf(sourceName);
            const targetIndex = fonts.lastIndexOf(target.name);
            fonts.splice(sourceIndex, 1);
            fonts.splice(targetIndex, 0, sourceName);
            const hasHidden = fonts.slice(1).includes(fonts[0]);
            if (!hasHidden) {
                fonts.unshift(fonts[0]);
            }
            updateConfig("editor.fontFamily", Font.toString(fonts), config, true);
        }
    }

    setConfig(font: Font, config: vscode.WorkspaceConfiguration | null = null, showError: boolean = false): void {
        config = config ?? vscode.workspace.getConfiguration();
        const fonts: string[] = Font.toArray(config.get("editor.fontFamily", ""));
        const hasHidden = fonts.slice(1).includes(fonts[0]);
        if (hasHidden) {
            fonts[0] = font.name;
        } else {
            fonts.unshift(font.name);
        }
        updateConfig(
            "editor.fontFamily",
            Font.toString(fonts),
            config,
            showError,
        );

        const fontLigatures: object = config.get(
            "theme-explorer.fontLigatureAssociation",
            {},
        );
        let liga = "";
        Object.entries(fontLigatures).forEach(([key, value]) => {
            if (key === fonts[0]) {
                liga = value;
            }
        });

                updateConfig(
                    "editor.fontLigatures",
            liga,
                    config,
                    showError,
                );
    }
}

class Theme extends Node {
    id: string;
    label: string;
    extension: { id: string; builtIn: boolean };
    checkboxState: vscode.TreeItemCheckboxState;
    command: vscode.Command | undefined = {
        title: "",
        command: "theme-explorer.clickThemeItem",
        arguments: [this],
    };

    constructor(id: string, label: string, extension: { id: string; builtIn: boolean }, ignored: boolean = false, checked: boolean = false) {
        super(label);
        this.id = id;
        this.label = label;
        this.extension = extension;
        this.iconPath = ignored ? new vscode.ThemeIcon("eye-closed") : "none";
        this.contextValue = ignored ? "ignored" : "";
        this.checkboxState = checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    }
}

type ThemeExtensionPoint = {
    id: string;
    label?: string;
    description?: string;
    path: string;
    uiTheme?: "vs" | "vs-dark" | "hc-black" | "hc-light";
};

class ThemeTree extends Tree<Theme> {
    root: Theme = new Theme("", "", { id: "", builtIn: false });

    makeTreeData() {
        const config = vscode.workspace.getConfiguration();
        const ignoreThemes: string[] = config.get("theme-explorer.ignoreThemes", []);
        for (const extension of vscode.extensions.all) {
            const themes: ThemeExtensionPoint[] = extension.packageJSON?.contributes?.themes ?? [];
            for (const theme of themes) {
                const label = theme.label ?? pathlib.basename(theme.path);
                const id = theme.id ?? label;
                if (this.checkThemeStyle(config, theme)) {
                    const builtIn = !!extension.extensionPath.match(/resources[\\/]app[\\/]extensions[\\/]/);
                    const ignored = ignoreThemes.includes(id);
                    const checked = id === config.get("workbench.colorTheme");
                    this.root.addChild(new Theme(id, label, { id: extension.id, builtIn }, ignored, checked));
                }
            }
        }
        this.root.children.sort((a, b) => a.label.localeCompare(b.label));
    }

    checkThemeStyle(config: vscode.WorkspaceConfiguration, theme: ThemeExtensionPoint) {
        const themeStyle: string = config.get("theme-explorer.themeStyle", "both");
        const uiTheme = theme.uiTheme ?? "vs-dark";
        if (themeStyle === "dark") {
            return uiTheme === "vs-dark";
        } else if (themeStyle === "light") {
            return uiTheme === "vs";
        } else if (themeStyle === "both") {
            return uiTheme === "vs-dark" || uiTheme === "vs";
        }
        return false;
    }

    setConfig(theme: Theme, config: vscode.WorkspaceConfiguration | null = null, showError: boolean = false): void {
        updateConfig("workbench.colorTheme", theme.id, config, showError);
    }
}

class Icon extends Theme {
    command: vscode.Command | undefined = {
        title: "",
        command: "theme-explorer.clickIconItem",
        arguments: [this],
    };
}

class IconTree extends Tree<Icon> {
    root: Icon = new Icon("", "", { id: "", builtIn: false });

    makeTreeData() {
        const config = vscode.workspace.getConfiguration();
        const ignoreIcons: string[] = config.get("theme-explorer.ignoreIcons", []);
        for (const extension of vscode.extensions.all) {
            const iconThemes: ThemeExtensionPoint[] = extension.packageJSON?.contributes?.iconThemes ?? [];
            for (const icon of iconThemes) {
                const label = icon.label ?? pathlib.basename(icon.path);
                const id = icon.id ?? label;
                const builtIn = !!extension.extensionPath.match(/resources[\\/]app[\\/]extensions[\\/]/);
                const ignored = ignoreIcons.includes(id);
                const checked = id === config.get("workbench.iconTheme");
                this.root.addChild(new Icon(id, label, { id: extension.id, builtIn }, ignored, checked));
            }
        }
        this.root.children.sort((a, b) => a.label.localeCompare(b.label));
    }

    setConfig(icon: Icon, config: vscode.WorkspaceConfiguration | null = null, showError: boolean = false): void {
        config = config ?? vscode.workspace.getConfiguration();
        updateConfig("workbench.iconTheme", icon.id, config, showError);
    }

    createView(): vscode.TreeView<Icon> {
        return vscode.window.createTreeView("theme-explorer.icon", {
            treeDataProvider: this,
        });
    }
}

class TreeManager {
    fontTree: FontTree;
    themeTree: ThemeTree;
    iconTree: IconTree;
    timer: NodeJS.Timeout | null = null;

    constructor(fontTree: FontTree, themeTree: ThemeTree, iconTree: IconTree) {
        this.fontTree = fontTree;
        this.themeTree = themeTree;
        this.iconTree = iconTree;
    }

    updateRandom(context: vscode.ExtensionContext, startup: boolean = false) {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const config = vscode.workspace.getConfiguration();
        const randomType: string = config.get("theme-explorer.randomType", "none");
        if (randomType === "interval") {
            const startTime: number = this.getStartTime(context);
            const interval: number = Math.max(config.get("theme-explorer.randomInterval", 5), 0.0005) * 1000 * 60 * 60;
            const currentTime = Date.now();
            const leftTime = interval + startTime - currentTime;
            this.timer = setTimeout(() => {
                this.changeAll(context, true);
                this.timer = setInterval(() => this.changeAll(context, true), interval);
            }, leftTime);
        } else if (randomType === "startup") {
            if (startup) {
                this.changeAll(context);
            }
        }
        if (randomType !== "interval") {
            context.globalState.update("startTime", undefined);
        }
    }

    changeAll(context: vscode.ExtensionContext, resetTimer: boolean = false) {
        const { fontTree, themeTree, iconTree } = this;
        if (resetTimer) {
            context.globalState.update("startTime", Date.now());
        }
        const config = vscode.workspace.getConfiguration();
        if (config.get("theme-explorer.changeFont", true)) {
            const font = fontTree.getRandomItem();
            if (font) {
                fontTree.setConfig(font, config);
                fontTree.needsScroll();
            }
        }
        if (config.get("theme-explorer.changeTheme", true)) {
            const theme = themeTree.getRandomItem();
            if (theme) {
                themeTree.setConfig(theme, config);
                themeTree.needsScroll();
            }
        }
        if (config.get("theme-explorer.changeIcon", true)) {
            const icon = iconTree.getRandomItem();
            if (icon) {
                iconTree.setConfig(icon, config);
                iconTree.needsScroll();
            }
        }
    }

    getStartTime(context: vscode.ExtensionContext): number {
        const startTime: number | undefined = context.globalState.get("startTime");
        if (startTime) {
            return startTime;
        } else {
            const currentTime = Date.now();
            context.globalState.update("startTime", currentTime);
            return currentTime;
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const fontTree = new FontTree();
    const themeTree = new ThemeTree();
    const iconTree = new IconTree();

    const treeManager = new TreeManager(fontTree, themeTree, iconTree);

    context.subscriptions.push(vscode.window.registerTreeDataProvider("theme-explorer.font", fontTree));
    context.subscriptions.push(vscode.window.registerTreeDataProvider("theme-explorer.theme", themeTree));
    context.subscriptions.push(vscode.window.registerTreeDataProvider("theme-explorer.icon", iconTree));

    const fontTreeView = vscode.window.createTreeView("theme-explorer.font", {
        treeDataProvider: fontTree,
        dragAndDropController: fontTree,
    });
    const themeTreeView = vscode.window.createTreeView("theme-explorer.theme", {
        treeDataProvider: themeTree,
    });
    const iconTreeView = vscode.window.createTreeView("theme-explorer.icon", {
        treeDataProvider: iconTree,
    });

    fontTree.setView(fontTreeView);
    themeTree.setView(themeTreeView);
    iconTree.setView(iconTreeView);

    context.subscriptions.push(fontTreeView.onDidChangeVisibility(({ visible }) => {
        if (visible) {
            fontTree.scrollToCurrent();
        }
    }));
    context.subscriptions.push(themeTreeView.onDidChangeVisibility(({ visible }) => {
        if (visible) {
            themeTree.scrollToCurrent();
        }
    }));
    context.subscriptions.push(iconTreeView.onDidChangeVisibility(({ visible }) => {
        if (visible) {
            iconTree.scrollToCurrent();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.randomAll", () => treeManager.changeAll(context)));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.clickFontItem", (font) => fontTree.setConfig(font)));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.clickThemeItem", (theme) => themeTree.setConfig(theme)));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.clickIconItem", (icon) => iconTree.setConfig(icon)));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.ignoreFont", (font: Font) => {
        const config = vscode.workspace.getConfiguration();
        const ignored: string[] = config.get("theme-explorer.ignoreFonts", []);
        ignored.push(font.name);
        updateConfig("theme-explorer.ignoreFonts", ignored, config, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.ignoreTheme", (theme: Theme) => {
        const config = vscode.workspace.getConfiguration();
        const ignored: string[] = config.get("theme-explorer.ignoreThemes", []);
        ignored.push(theme.id);
        updateConfig("theme-explorer.ignoreThemes", ignored, config, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.ignoreIcon", (icon: Icon) => {
        const config = vscode.workspace.getConfiguration();
        const ignored: string[] = config.get("theme-explorer.ignoreIcons", []);
        ignored.push(icon.id);
        updateConfig("theme-explorer.ignoreIcons", ignored, config, true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.unignoreFont", (font: Font) => {
        const config = vscode.workspace.getConfiguration();
        const ignored: string[] = config.get("theme-explorer.ignoreFonts", []);
        const index = ignored.indexOf(font.name);
        if (index >= 0) {
            ignored.splice(index, 1);
        }
        updateConfig("theme-explorer.ignoreFonts", ignored, config, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.unignoreTheme", (theme: Theme) => {
        const config = vscode.workspace.getConfiguration();
        const ignored: string[] = config.get("theme-explorer.ignoreThemes", []);
        const index = ignored.indexOf(theme.id);
        if (index >= 0) {
            ignored.splice(index, 1);
        }
        updateConfig("theme-explorer.ignoreThemes", ignored, config, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.unignoreIcon", (icon: Icon) => {
        const config = vscode.workspace.getConfiguration();
        const ignored: string[] = config.get("theme-explorer.ignoreIcons", []);
        const index = ignored.indexOf(icon.id);
        if (index >= 0) {
            ignored.splice(index, 1);
        }
        updateConfig("theme-explorer.ignoreIcons", ignored, config, true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.deleteFont", (font: Font) => {
        const config = vscode.workspace.getConfiguration();
        const fonts: string[] = Font.toArray(config.get("editor.fontFamily", ""));
        fonts.splice(fonts.lastIndexOf(font.name), 1);
        if (fonts[0] === font.name) {
            fonts.shift();
        }
        updateConfig("editor.fontFamily", Font.toString(fonts), config, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.deleteTheme", (theme: Theme | Icon) => {
        const extension = vscode.extensions.all.find((extension) => extension.id === theme.extension.id);
        if (extension) {
            if (theme.extension.builtIn) {
                vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(`vscode:extension/${extension.id}`));
            } else {
                const themes: ThemeExtensionPoint[] = [
                    ...extension.packageJSON?.contributes?.themes ?? [],
                    ...extension.packageJSON?.contributes?.iconThemes ?? [],
                ];
                const name = extension.packageJSON.displayName ?? extension.packageJSON.name;
                const message = `This will uninstall the "${name}" extension, including the following themes:`;
                const themesInfo = themes.map((theme) => {
                    const label = theme.label ?? pathlib.basename(theme.path);
                    return label;
                });
                const detailMessage = themesInfo.join("\n") + "\n\n* Some extensions need to be reloaded after uninstalling";
                vscode.window.showWarningMessage(message, { modal: true, detail: detailMessage }, { title: "Confirm" }, {
                    title: "Cancel",
                    isCloseAffordance: true,
                }).then((option) => {
                    if (option?.title === "Confirm") {
                        vscode.commands.executeCommand("workbench.extensions.uninstallExtension", extension.id);
                    }
                });
            }
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.deleteIcon", (icon: Icon) => {
        vscode.commands.executeCommand("theme-explorer.deleteTheme", icon);
    }));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.addFont", () => {
        vscode.window.showInputBox({ title: "New Font" }).then((value) => {
            if (value) {
                const config = vscode.workspace.getConfiguration();
                const fonts: string[] = yaml.parse("[" + config.get("editor.fontFamily") + "]");
                const newFonts = yaml.parse("[" + value + "]");
                fonts.push(...newFonts);
                updateConfig("editor.fontFamily", Font.toString(fonts), config, true);
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.addTheme", () => {
        vscode.commands.executeCommand("workbench.extensions.search", "category:themes");
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.addIcon", () => {
        vscode.commands.executeCommand("workbench.extensions.search", "tag:icon-theme");
    }));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.themeStyleDark", () => {
        const config = vscode.workspace.getConfiguration();
        updateConfig("theme-explorer.themeStyle", "light", config, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.themeStyleLight", () => {
        const config = vscode.workspace.getConfiguration();
        updateConfig("theme-explorer.themeStyle", "both", config, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.themeStyleBoth", () => {
        const config = vscode.workspace.getConfiguration();
        updateConfig("theme-explorer.themeStyle", "dark", config, true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.randomFont", () => {
        const font = fontTree.getRandomItem();
        if (font) {
            fontTree.setConfig(font, null, true);
            fontTree.needsScroll();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.randomIcon", () => {
        const icon = iconTree.getRandomItem();
        if (icon) {
            iconTree.setConfig(icon, null, true);
            iconTree.needsScroll();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("theme-explorer.randomTheme", () => {
        const theme = themeTree.getRandomItem();
        if (theme) {
            themeTree.setConfig(theme, null, true);
            themeTree.needsScroll();
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(({ affectsConfiguration }) => {
        if (affectsConfiguration("editor.fontFamily") || affectsConfiguration("theme-explorer.ignoreFonts")) {
            fontTree.refresh();
        } else if (affectsConfiguration("workbench.colorTheme") || affectsConfiguration("theme-explorer.ignoreThemes")
            || affectsConfiguration("theme-explorer.themeStyle"))
        {
            themeTree.refresh();
        } else if (affectsConfiguration("workbench.iconTheme") || affectsConfiguration("theme-explorer.ignoreIcons")) {
            iconTree.refresh();
        } else if (affectsConfiguration("theme-explorer.randomType") || affectsConfiguration("theme-explorer.randomInterval")) {
            treeManager.updateRandom(context);
        }
    }));

    context.subscriptions.push(vscode.extensions.onDidChange(() => {
        themeTree.refresh();
        iconTree.refresh();
    }));

    fontTree.refresh();
    themeTree.refresh();
    iconTree.refresh();

    treeManager.updateRandom(context, true);
}

function updateConfig(section: string, value: any, config: vscode.WorkspaceConfiguration | null = null, showError: boolean = false) {
    config ??= vscode.workspace.getConfiguration();
    config.update(section, value, true).then(null, (reason: Error) => {
        if (showError) {
            vscode.window.showErrorMessage(reason.message);
        }
    });
}
