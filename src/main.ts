import { addIcon, Plugin } from 'obsidian';
import * as feather from 'feather-icons'; //import just icons I want?
import { PomoSettingTab, PomoSettings, DEFAULT_SETTINGS } from './settings';
import { getDailyNoteFile, Mode, Timer } from './timer';


export default class PomoTimerPlugin extends Plugin {
    settings: PomoSettings;
    statusBar: HTMLElement;
    timer: Timer;
    statusIntervalId: number;

    async onload() {
        console.log('Loading status bar pomodoro timer');

        await this.loadSettings();
        this.addSettingTab(new PomoSettingTab(this.app, this));

        this.statusBar = this.addStatusBarItem();
        this.statusBar.addClass("statusbar-pomo");
        if (this.settings.logging === true) {
            this.openLogFileOnClick();
        }

        this.timer = new Timer(this);

        /*Adds icon to the left side bar which starts the pomo timer when clicked
          if no timer is currently running, and otherwise quits current timer*/
        if (this.settings.ribbonIcon === true) {
            this.addRibbonIcon('clock', 'Start pomodoro', async () => {
                await this.timer.onRibbonIconClick();
            });
        }

        addIcon("feather-play", feather.icons.play.toString());
        addIcon("feather-pause", feather.icons.pause.toString());
        addIcon("feather-quit", feather.icons.x.toSvg({ viewBox: "0 0 24 24", width: "100", height: "100" }).toString()); //https://github.com/phibr0/obsidian-customizable-sidebar/blob/master/src/ui/icons.ts

        this.addCommand({
            id: 'start-satusbar-pomo',
            name: 'Start pomodoro',
            icon: 'feather-play',
            checkCallback: (checking: boolean) => {
                let leaf = this.app.workspace.activeLeaf;
                if (leaf) {
                    if (!checking) {
                        this.timer.startTimer(Mode.Pomo);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'pause-satusbar-pomo',
            name: 'Toggle timer pause',
            icon: 'feather-pause',
            checkCallback: (checking: boolean) => {
                let leaf = this.app.workspace.activeLeaf;
                if (leaf && this.timer.mode !== Mode.NoTimer) {
                    if (!checking) {
                        this.timer.togglePause();
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'quit-satusbar-pomo',
            name: 'Quit timer',
            icon: 'feather-quit',
            checkCallback: (checking: boolean) => {
                let leaf = this.app.workspace.activeLeaf;
                if (leaf && this.timer.mode !== Mode.NoTimer) {
                    if (!checking) {
                        this.timer.quitTimer();
                    }
                    return true;
                }
                return false;
            }
        });
    }


    //on click, open log file; from Day Planner https://github.com/lynchjames/obsidian-day-planner/blob/c8d4d33af294bde4586a943463e8042c0f6a3a2d/src/status-bar.ts#L53
    openLogFileOnClick() {
        this.statusBar.addClass("statusbar-pomo-logging");
        this.statusBar.onClickEvent(async (ev: any) => {
            if (this.settings.logging === true) { //this is hacky, ideally I'd just unwatch the onClickEvent as soon as I turned logging off
                //SPM added
                if (this.timer) {
                    if (this.timer.mode !== Mode.NoTimer) {
                        this.timer.togglePause();
                    }
                }

                /*
                try {
                    var file: string;
                    if (this.settings.logToDaily === true) {
                        file = (await getDailyNoteFile()).path;
                    } else {
                        file = this.settings.logFile;
                    }

                    this.app.workspace.openLinkText(file, '', false);
                } catch (error) {
                    console.log(error);
                }
                */
            }
        });
    }

    /**************  Meta  **************/

    onunload() {
        if (this.timer) { this.timer.quitTimer(); }
        console.log('Unloading status bar pomodoro timer');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}