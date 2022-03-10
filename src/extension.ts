/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as JenkinsIndicator from "./JenkinsIndicator";
import { Setting } from "./setting";
import { registerWhatsNew } from "./whats-new/commands";
import { Container } from "./container";
import { Uri } from "vscode";
import { appendPath, readFileUri, uriExists } from "./fs";

declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;

export async function activate(context: vscode.ExtensionContext) {
    
    Container.context = context;

    let jenkinsIndicator: JenkinsIndicator.JenkinsIndicator;
    let jenkinsController: JenkinsIndicator.JenkinsIndicatorController; 

    let currentSettings: Setting[];
    
    if (await hasJenkinsInAnyRoot()) {
        createJenkinsIndicator(context);
        updateStatus();
    }

    registerWhatsNew();
    
    const dispUpdateStatus = vscode.commands.registerCommand("jenkins.updateStatus", () => updateStatus(true));
    context.subscriptions.push(dispUpdateStatus);

    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        if (await hasJenkinsInAnyRoot()) {
            createJenkinsIndicator(context);
        }
        updateStatus()}
    ));

    const dispOpenInJenkins = vscode.commands.registerCommand("jenkins.openInJenkins", async () => {
        if (!await hasJenkinsInAnyRoot()) {
            vscode.window.showWarningMessage("The project is not enabled for Jenkins. Missing .jenkins file.");
            return;
        } 

        const settings = currentSettings;
        if (!settings.length) {
            vscode.window.showWarningMessage("The current project is not enabled for Jenkins. Please review .jenkins file.");
            return;
        }

        if (settings.length > 1) {
            vscode.window.showQuickPick(settings.map(setting => setting.name ? setting.name : setting.url), {
                placeHolder : "Select the Jenkins job to open in browser"
            }).then((settingName: string) => {
                vscode.commands.executeCommand("Jenkins." + settingName + ".openInJenkins");
            });
        } else {
            vscode.commands.executeCommand("Jenkins." + settings[0].name + ".openInJenkins");
        }        
    });
    context.subscriptions.push(dispOpenInJenkins);

    const dispOpenInJenkinsConsoleOutput = vscode.commands.registerCommand("jenkins.openInJenkinsConsoleOutput", async () => {
        if (!await hasJenkinsInAnyRoot()) {
            vscode.window.showWarningMessage("The project is not enabled for Jenkins. Missing .jenkins file.");
            return;
        } 

        const settings = currentSettings;
        if (!settings.length) {
            vscode.window.showWarningMessage("The current project is not enabled for Jenkins. Please review .jenkins file.");
            return;
        }

        if (settings.length > 1) {
            vscode.window.showQuickPick(settings.map(setting => setting.name ? setting.name : setting.url), {
                placeHolder : "Select the Jenkins job to open in browser"
            }).then((settingName: string) => {
                vscode.commands.executeCommand("Jenkins." + settingName + ".openInJenkinsConsoleOutput");
            });
        } else {
            vscode.commands.executeCommand("Jenkins." + settings[0].name + ".openInJenkinsConsoleOutput");
        }   
    });
    context.subscriptions.push(dispOpenInJenkinsConsoleOutput);
    
    function createJenkinsIndicator(aContext: vscode.ExtensionContext) {
        if (jenkinsIndicator) {
            return;
        }
        
        jenkinsIndicator = new JenkinsIndicator.JenkinsIndicator();
        jenkinsController = new JenkinsIndicator.JenkinsIndicatorController(jenkinsIndicator);
        aContext.subscriptions.push(jenkinsController);
        aContext.subscriptions.push(jenkinsIndicator);
    }

    async function updateStatus(showMessage?: boolean) {
        if (showMessage && !await hasJenkinsInAnyRoot()) {
            vscode.window.showWarningMessage("The project is not enabled for Jenkins. Missing .jenkins file.");
            return;
        }

        if (jenkinsIndicator) { 
            currentSettings = jenkinsIndicator.updateJenkinsStatus(await getCurrentSettings(), registerCommand, deRegisterCommand);
        }
    }
    
    // let interval;
    const polling: number = vscode.workspace.getConfiguration("jenkins").get("polling", 0);
    if (polling > 0) {
        setInterval(() => updateStatus(), polling * 60000);
    }

    async function hasJenkinsInAnyRoot(): Promise<boolean> {

        if (!vscode.workspace.workspaceFolders) {
            return false;
        }

        let hasAny = false;

        // for (let index = 0; index < vscode.workspace.workspaceFolders.length; index++) {
        for (const element of vscode.workspace.workspaceFolders) {
            // const element: vscode.WorkspaceFolder = vscode.workspace.workspaceFolders[index];
            hasAny = !!await getConfigPath(element.uri);
            if (hasAny) {
                return hasAny;
            }
        }

        return hasAny;
    }

    async function getCurrentSettings(): Promise<Setting[]> {
        if (!vscode.workspace.workspaceFolders) {
            return [];
        }

        let settings: Setting[] = [];
        try {
            for (const element of vscode.workspace.workspaceFolders) {
                const jenkinsSettingsPath = await getConfigPath(element.uri);            
                if (jenkinsSettingsPath.fsPath !== element.uri.fsPath) {
                    const jenkinsSettings = await readSettings(jenkinsSettingsPath);
                    const jenkinsSettings2 = Array.isArray(jenkinsSettings) ? jenkinsSettings : [jenkinsSettings];
                    settings = settings.concat(...jenkinsSettings2);
                }
            }       
        } catch (error) {
            vscode.window.showErrorMessage("Error while retrieving Jenkins settings");
        }
        return settings;
    }

    async function readSettings(jenkinsSettingsPath: Uri): Promise<string> {
        if (jenkinsSettingsPath.fsPath.endsWith(".jenkinsrc.js")) {
            const r = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
             delete r.cache[r.resolve(jenkinsSettingsPath.fsPath)];
             return await r(jenkinsSettingsPath.fsPath);
        } else {
            const content = await readFileUri(jenkinsSettingsPath);
            return content;
        }
    }

    function registerCommand(cmd: string, callback: () => void) {
        const command = vscode.commands.registerCommand(cmd, callback);
        context.subscriptions.push(new Command(cmd, command));
    }

    function deRegisterCommand(cmd: string) {
        let foundIndex = -1;
        for (let index = 0; index < context.subscriptions.length; index++) {
            const subscription = context.subscriptions[index];
            if (subscription instanceof Command) {
                if (subscription.cmdId === cmd) {
                    subscription.dispose();
                    foundIndex = index;
                    break;
                }
            }            
        }

        if (foundIndex > -1) {
            context.subscriptions.splice(foundIndex, 1);
        }
        return;
    }

    async function getConfigPath(uri: Uri): Promise<Uri> {
        if (await uriExists(appendPath(uri, ".jenkinsrc.js"))) {
            return appendPath(uri, ".jenkinsrc.js");
        } else if (uriExists(appendPath(uri, ".jenkins"))) {
            return appendPath(uri, ".jenkins");
        }
        return uri;
    }

    function createWatcher(folder: vscode.WorkspaceFolder) {
        const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "*.{jenkins,jenkins.js}"));
        fileSystemWatcher.onDidChange(() => updateStatus(false), context.subscriptions);
        fileSystemWatcher.onDidCreate(() => updateStatus(false), context.subscriptions);
        fileSystemWatcher.onDidDelete(() => updateStatus(false), context.subscriptions);
        context.subscriptions.push(fileSystemWatcher);
    }

    if (vscode.workspace.workspaceFolders) {
        vscode.workspace.workspaceFolders.forEach(folder => createWatcher(folder));
    }
}

class Command {
    constructor(public cmdId: string, private command: vscode.Disposable) {}
    public dispose() {
        return this.command.dispose();
    }
}