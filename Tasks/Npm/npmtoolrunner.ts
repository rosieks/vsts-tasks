import * as fs from 'fs';
import * as path from 'path';
import { format, parse, Url } from 'url';
import * as Q from 'q';

import * as tl from 'vsts-task-lib/task';
import * as tr from 'vsts-task-lib/toolrunner';

export class NpmToolRunner extends tr.ToolRunner {
    private cacheLocation: string;
    private dbg: boolean;

    constructor(private workingDirectory: string, private npmrc?: string) {
        super('npm');

        this.on('debug', (message: string) => {
            tl.debug(message);
        });

        let debugVar = tl.getVariable('System.Debug') || '';
        if (debugVar.toLowerCase() === 'true') {
            this.dbg = true;
        }

        let cacheOptions = { silent: true } as tr.IExecSyncOptions;
        this.cacheLocation = tl.execSync('npm', 'config get cache', this._prepareNpmEnvironment(cacheOptions)).stdout.trim();
    }

    public exec(options?: tr.IExecOptions): Q.Promise<number> {
        options = this._prepareNpmEnvironment(options) as tr.IExecOptions;

        return super.exec(options).catch((reason: any) => {
            return this._printDebugLog(this._getDebugLogPath(options)).then((value: void): number => {
                throw reason;
            });
        });
    }

    public execSync(options?: tr.IExecSyncOptions): tr.IExecSyncResult {
        options = this._prepareNpmEnvironment(options);

        const execResult = super.execSync(options);
        if (execResult.code !== 0) {
            this._printDebugLogSync(this._getDebugLogPath(options));
            throw new Error(tl.loc('NpmFailed', execResult.code));
        }

        return execResult;
    }

    private static _getProxyFromEnvironment(): string {
        let proxyUrl: string = tl.getVariable('agent.proxyurl');
        if (proxyUrl) {
            let proxy: Url = parse(proxyUrl);
            let proxyUsername: string = tl.getVariable('agent.proxyusername') || '';
            let proxyPassword: string = tl.getVariable('agent.proxypassword') || '';

            let auth = `${proxyUsername}:${proxyPassword}`;
            proxy.auth = auth;

            return format(proxy);
        }

        return undefined;
    }

    private _prepareNpmEnvironment(options?: tr.IExecSyncOptions): tr.IExecSyncOptions {
        options = options || <tr.IExecSyncOptions>{};
        options.cwd = this.workingDirectory;

        if (options.env === undefined) {
            options.env = process.env;
        }

        if (this.dbg) {
            options.env['NPM_CONFIG_LOGLEVEL'] = 'verbose';
        }

        if (this.npmrc) {
            options.env['NPM_CONFIG_USERCONFIG'] = this.npmrc;
        }

        let proxy = NpmToolRunner._getProxyFromEnvironment();
        if (proxy) {
            tl.debug(`Using proxy "${proxy}" for npm`);
            options.env['NPM_CONFIG_PROXY'] = proxy;
            options.env['NPM_CONFIG_HTTPS-PROXY'] = proxy;
        }

        let config = tl.execSync('npm', `config list ${this.dbg ? '-l' : ''}`, options);
        return options;
    }

    private _getDebugLogPath(options?: tr.IExecSyncOptions): string {
        // check cache
        const logs = tl.findMatch(path.join(this.cacheLocation, '_logs'), '*-debug.log');
        if (logs && logs.length > 0) {
            const debugLog = logs[logs.length - 1];
            console.log(tl.loc('FoundNpmDebugLog', debugLog));
            return debugLog;
        }

        // check working dir
        const cwd = options && options.cwd ? options.cwd : process.cwd;
        const debugLog = path.join(cwd, 'npm-debug.log');
        tl.debug(tl.loc('TestDebugLog', debugLog));
        if (tl.exist(debugLog)) {
            console.log(tl.loc('FoundNpmDebugLog', debugLog));
            return debugLog;
        }

        tl.warning(tl.loc('DebugLogNotFound'));
        return undefined;
    }

    private _printDebugLog(log: string): Q.Promise<void> {
        if (!log) {
            return Q.fcall(() => {});
        }

        return Q.nfcall(fs.readFile, log, 'utf-8').then((data: string) => {
            console.log(data);
        });
    }

    private _printDebugLogSync(log: string): void {
        if (!log) {
            return;
        }

        console.log(fs.readFileSync(log, 'utf-8'));
    }
}