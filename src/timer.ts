import { Notice, moment, TFolder, TFile, Modal, App, SuggestModal } from 'obsidian';
import { getDailyNote, createDailyNote, getAllDailyNotes } from 'obsidian-daily-notes-interface';
import type { Moment } from 'moment';
import { notificationUrl, whiteNoiseUrl } from './audio_urls';
import { WhiteNoise } from './white_noise';
import { PomoSettings } from './settings';
import PomoTimerPlugin from './main';

const MILLISECS_IN_MINUTE = 60 * 1000;

export const enum Mode {
    Pomo,
    ShortBreak,
    LongBreak,
    NoTimer
}

abstract class inputModal extends SuggestModal<string> {
    constructor(app: App) {
        super(app);
        this.setPlaceholder("Enter a short description for what you are working on...");
        /*
        this.setInstructions([
            { command: 'Plain Text: ', purpose: 'No [[Page]] or #Tag required' },
        ]);
        */
    }

    onOpen() {
        let modalBg: HTMLElement = document.querySelector('.modal-bg');
        modalBg.style.backgroundColor = '#00000029';
        let modalPrompt: HTMLElement = document.querySelector('.prompt');
        modalPrompt.style.border = '1px solid #483699';
        let modalInput: any = modalPrompt.querySelector('.prompt-input');
        modalInput.focus();
        modalInput.select();
    }

    getSuggestions(query: string): string[] {
        return [query];
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.innerText = value;
    }
}

class TaskModal extends inputModal {
    constructor(app: App, private pomoPlugin: PomoTimerPlugin) {
        super(app);
    }

    onChooseSuggestion(item: string, _: MouseEvent | KeyboardEvent): void {
        this.pomoPlugin.timer.taskDescription = item;
        this.pomoPlugin.timer.startTimer(Mode.Pomo);
    }
}

async function waitForTaskModal(
    thisApp: App,
    thisPlugin: PomoTimerPlugin
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const modal = new TaskModal(thisApp, thisPlugin);
        modal.onClose = () => {
            resolve(true);
        };
        modal.open();
    });
}

export class Timer {
    plugin: PomoTimerPlugin;
    settings: PomoSettings;
    startTime: Moment; /*when currently running timer started*/
    endTime: Moment;   /*when currently running timer will end if not paused*/
    mode: Mode;
    pausedTime: number;  /*Time left on paused timer, in milliseconds*/
    paused: boolean;
    pomosSinceStart: number;
    cyclesSinceLastAutoStop: number;
    activeNote: TFile;
    whiteNoisePlayer: WhiteNoise;
    taskDescription: string;
    isModalOpen: boolean;

    constructor(plugin: PomoTimerPlugin) {
        this.plugin = plugin;
        this.settings = plugin.settings;
        this.mode = Mode.NoTimer;
        this.paused = false;
        this.pomosSinceStart = 0;
        this.cyclesSinceLastAutoStop = 0;
        this.taskDescription = '';
        this.isModalOpen = false;

        if (this.settings.whiteNoise === true) {
            this.whiteNoisePlayer = new WhiteNoise(plugin, whiteNoiseUrl);
        }
    }

    async onRibbonIconClick() {
        if (this.mode === Mode.NoTimer) {  //if starting from not having a timer running/paused
            if (this.plugin.settings.logText.indexOf(`{DESC}`) > -1) {
                await waitForTaskModal(this.plugin.app, this.plugin);
            } else {
                this.startTimer(Mode.Pomo);
            }
        } else { //if timer exists, pause or unpause
            this.togglePause();
        }
    }

    /*Set status bar to remaining time or empty string if no timer is running*/
    //handling switching logic here, should spin out
    async setStatusBarText(): Promise<string> {
        if (!this.isModalOpen) {
            if (this.mode !== Mode.NoTimer) {
                if (this.paused === true) {
                    return millisecsToString(this.pausedTime); //just show the paused time
                }
                /*if reaching the end of the current timer, end of current timer*/
                else if (moment().isSameOrAfter(this.endTime)) {
                    await this.handleTimerEnd();
                }
                if (this.mode === Mode.ShortBreak || this.mode === Mode.LongBreak) {
                    return `B: ${millisecsToString(this.getCountdown())}`;
                }
                return millisecsToString(this.getCountdown()); //return display value
            } else {
                return ""; //fixes TypeError: failed to execute 'appendChild' on 'Node https://github.com/kzhovn/statusbar-pomo-obsidian/issues/4
            }
        } else {
            return "";
        }
    }

    async handleTimerEnd() {
        if (this.mode === Mode.Pomo) { //completed another pomo
            this.pomosSinceStart += 1;

            if (this.settings.logging === true) {
                await this.logPomo();
            }
        } else if (this.mode === Mode.ShortBreak || this.mode === Mode.LongBreak) {
            this.cyclesSinceLastAutoStop += 1;
        }

        //switch mode
        if (this.settings.notificationSound === true) { //play sound end of timer
            playNotification();
        }

        if (this.mode === Mode.Pomo) {
            if (this.pomosSinceStart % this.settings.longBreakInterval === 0) {
                this.startTimer(Mode.LongBreak);
            } else {
                this.startTimer(Mode.ShortBreak);
            }
        } else { //short break. long break, or no timer
            if (this.plugin.settings.logText.indexOf(`{DESC}`) > -1) {
                this.isModalOpen = true;
                await waitForTaskModal(this.plugin.app, this.plugin);
                this.cyclesSinceLastAutoStop = 0;
                this.isModalOpen = false;
            } else {
                this.startTimer(Mode.Pomo);
            }
        }

        if (this.settings.autostartTimer === false && this.settings.numAutoCycles <= this.cyclesSinceLastAutoStop) { //if autostart disabled, pause and allow user to start manually
            this.pauseTimer();
            this.cyclesSinceLastAutoStop = 0;
        }
    }

    async quitTimer(): Promise<void> {
        clearInterval(this.plugin.statusIntervalId);
        this.plugin.statusIntervalId = null;
        this.mode = Mode.NoTimer;
        this.startTime = moment(0);
        this.endTime = moment(0);
        this.paused = false;
        this.pomosSinceStart = 0;

        if (this.settings.whiteNoise === true) {
            this.whiteNoisePlayer.stopWhiteNoise();
        }

        this.plugin.statusBar.setText(await this.setStatusBarText());
        await this.plugin.loadSettings(); //why am I loading settings on quit? to ensure that when I restart everything is correct? seems weird
    }

    pauseTimer(): void {
        this.paused = true;
        this.pausedTime = this.getCountdown();

        if (this.settings.whiteNoise === true) {
            this.whiteNoisePlayer.stopWhiteNoise();
        }
    }

    togglePause() {
        if (this.paused === true) {
            this.restartTimer();
        } else if (this.mode !== Mode.NoTimer) { //if some timer running
            this.pauseTimer();
            new Notice("Timer paused.")
        }
    }

    restartTimer(): void {
        this.setStartAndEndTime(this.pausedTime);
        this.modeRestartingNotification();
        this.paused = false;

        if (this.settings.whiteNoise === true) {
            this.whiteNoisePlayer.whiteNoise();
        }
    }

    startTimer(mode: Mode): void {
        this.mode = mode;
        this.paused = false;
        if (!this.plugin.statusIntervalId) {
            //Update status bar timer ever half second
            const intervalId = window.setInterval(async () => this.plugin.statusBar.setText(await this.setStatusBarText()), 500);
            this.plugin.registerInterval(intervalId);
            this.plugin.statusIntervalId = intervalId;
        }

        if (this.settings.logActiveNote === true) {
            const activeView = this.plugin.app.workspace.getActiveFile();
            if (activeView) {
                this.activeNote = activeView;
            }
        }

        this.setStartAndEndTime(this.getTotalModeMillisecs());
        this.modeStartingNotification();

        if (this.settings.whiteNoise === true) {
            this.whiteNoisePlayer.whiteNoise();
        }
    }

    setStartAndEndTime(millisecsLeft: number): void {
        this.startTime = moment(); //start time to current time
        this.endTime = moment().add(millisecsLeft, 'milliseconds');
    }

    /*Return milliseconds left until end of timer*/
    getCountdown(): number {
        let endTimeClone = this.endTime.clone(); //rewrite with freeze?
        return endTimeClone.diff(moment());
    }

    getTotalModeMillisecs(): number {
        switch (this.mode) {
            case Mode.Pomo: {
                if (this.settings.pomo === 1) {
                    return MILLISECS_IN_MINUTE / 30; //Do a quick 2 seconds for testing if set to 1 minute
                } else {
                    return this.settings.pomo * MILLISECS_IN_MINUTE;
                }
            }
            case Mode.ShortBreak: {
                if (this.settings.shortBreak === 1) {
                    return MILLISECS_IN_MINUTE / 30; //Do a quick 2 seconds for testing if set to 1 minute
                } else {
                    return this.settings.shortBreak * MILLISECS_IN_MINUTE;
                }
            }
            case Mode.LongBreak: {
                if (this.settings.longBreak === 1) {
                    return MILLISECS_IN_MINUTE / 30; //Do a quick 2 seconds for testing if set to 1 minute
                } else {
                    return this.settings.longBreak * MILLISECS_IN_MINUTE;
                }
            }
            case Mode.NoTimer: {
                throw new Error("Mode NoTimer does not have an associated time value");
            }
        }
    }



    /**************  Notifications  **************/
    /*Sends notification corresponding to whatever the mode is at the moment it's called*/
    modeStartingNotification(): void {
        let time = this.getTotalModeMillisecs();
        let unit: string;

        if (time >= MILLISECS_IN_MINUTE) { /*display in minutes*/
            time = Math.floor(time / MILLISECS_IN_MINUTE);
            unit = 'minute';
        } else { /*less than a minute, display in seconds*/
            time = Math.floor(time / 1000); //convert to secs
            unit = 'second';
        }

        switch (this.mode) {
            case (Mode.Pomo): {
                new Notice(`Starting ${time} ${unit} pomodoro.`);
                break;
            }
            case (Mode.ShortBreak):
            case (Mode.LongBreak): {
                new Notice(`Starting ${time} ${unit} break.`);
                break;
            }
            case (Mode.NoTimer): {
                new Notice('Quitting pomodoro timer.');
                break;
            }
        }
    }

    modeRestartingNotification(): void {
        switch (this.mode) {
            case (Mode.Pomo): {
                new Notice(`Resuming pomodoro timer`);
                break;
            }
            case (Mode.ShortBreak):
            case (Mode.LongBreak): {
                new Notice(`Resuming break`);
                break;
            }
        }
    }



    /**************  Logging  **************/
    async logPomo(): Promise<void> {
        const dtFormat = moment().format(`YYYY-MM-DD`);
        const tmFormat = moment().format(`hh:mm A`);
        let linkNote = ``;
        if (this.settings.logActiveNote === true) { //append link to note that was active when pomo started
            linkNote = this.plugin.app.fileManager.generateMarkdownLink(this.activeNote, '');
        }
        let logText = this.settings.logText;
        logText = logText.replace(/\{DATE\}/g, dtFormat);
        logText = logText.replace(/\{TIME\}/g, tmFormat);
        logText = logText.replace(/\{LINK\}/g, linkNote);
        logText = logText.replace(/\{NEWLINE\}/g, '\n');
        logText = logText.replace(/\{DESC\}/g, this.taskDescription);
        this.taskDescription = ``;

        if (this.settings.logToDaily === true) { //use today's note
            let file = (await getDailyNoteFile()).path;
            await this.appendFile(file, logText);
        } else { //use file given in settings
            let file = this.plugin.app.vault.getAbstractFileByPath(this.settings.logFile);

            if (!file || file! instanceof TFolder) { //if no file, create
                console.log("Creating pomodoro log file");
                await this.plugin.app.vault.create(this.settings.logFile, "");
            }

            await this.prependFile(this.settings.logFile, logText);
        }
    }

    //from Note Refactor plugin by James Lynch, https://github.com/lynchjames/note-refactor-obsidian/blob/80c1a23a1352b5d22c70f1b1d915b4e0a1b2b33f/src/obsidian-file.ts#L69
    async appendFile(filePath: string, note: string): Promise<void> {
        let existingContent = await this.plugin.app.vault.adapter.read(filePath);
        if (existingContent.length > 0) {
            existingContent = existingContent + '\n';
        }
        await this.plugin.app.vault.adapter.write(filePath, existingContent + note);
    }

    async prependFile(filePath: string, note: string): Promise<void> {
        let existingContent = await this.plugin.app.vault.adapter.read(filePath);
        if (existingContent.length > 0) {
            existingContent = '\n' + existingContent;
        }
        await this.plugin.app.vault.adapter.write(filePath, `${note}${existingContent}`);
    }
}

/*Returns [HH:]mm:ss left on the current timer*/
function millisecsToString(millisecs: number): string {
    let formattedCountDown: string;

    if (millisecs >= 60 * 60 * 1000) { /* >= 1 hour*/
        formattedCountDown = moment.utc(millisecs).format('HH:mm:ss');
    } else {
        formattedCountDown = moment.utc(millisecs).format('mm:ss');
    }

    return formattedCountDown.toString();
}

function playNotification(): void {
    const audio = new Audio(notificationUrl);
    audio.play();
}

export async function getDailyNoteFile(): Promise<TFile> {
    const file = getDailyNote(moment(), getAllDailyNotes());

    if (!file) {
        return await createDailyNote(moment());
    }

    return file;
}






