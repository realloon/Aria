import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const helloWorldCommand = vscode.commands.registerCommand("aria.helloWorld", () => {
    vscode.window.showInformationMessage("Hello from Aria.");
  });

  context.subscriptions.push(helloWorldCommand);
}

export function deactivate() {}
