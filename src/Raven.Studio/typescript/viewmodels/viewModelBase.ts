/// <reference path="../../typings/tsd.d.ts"/>

import appUrl = require("common/appUrl");
import activeResourceTracker = require("viewmodels/resources/activeResourceTracker");
import router = require("plugins/router");
import app = require("durandal/app");
import changeSubscription = require("common/changeSubscription");
import oauthContext = require("common/oauthContext");
import changesContext = require("common/changesContext");
import messagePublisher = require("common/messagePublisher");
import confirmationDialog = require("viewmodels/common/confirmationDialog");
import saveDocumentCommand = require("commands/database/documents/saveDocumentCommand");
import document = require("models/database/documents/document");
import downloader = require("common/downloader");

/*
 * Base view model class that provides basic view model services, such as tracking the active database and providing a means to add keyboard shortcuts.
*/
class viewModelBase {

    activeDatabase = activeResourceTracker.default.database;
    activeFilesystem = activeResourceTracker.default.fileSystem;
    activeCounterStorage = activeResourceTracker.default.counterStorage;
    activeTimeSeries = activeResourceTracker.default.timeSeries;
    
    downloader = new downloader();

    isBusy = ko.observable<boolean>(false);

    private keyboardShortcutDomContainers: string[] = [];
    static modelPollingHandle: number; // mark as static to fix https://github.com/BlueSpire/Durandal/issues/181
    notifications: Array<changeSubscription> = [];
    appUrls: computedAppUrls;
    private postboxSubscriptions: Array<KnockoutSubscription> = [];
    static showSplash = ko.observable<boolean>(false);
    private isAttached = false;
    
    dirtyFlag = new ko.DirtyFlag([]);

    currentHelpLink = ko.observable<string>().subscribeTo('globalHelpLink', true);

    //holds full studio version eg. 3.0.3528
    static clientVersion = ko.observable<string>();
    static hasContinueTestOption = ko.observable<boolean>(false);

    constructor() {
        this.appUrls = appUrl.forCurrentDatabase();
    }

    /*
     * Called by Durandal when checking whether this navigation is allowed. 
     * Possible return values: boolean, promise<boolean>, {redirect: 'some/other/route'}, promise<{redirect: 'some/other/route'}>
     * 
     * We use this to determine whether we should allow navigation to a system DB page.
     * p.s. from Judah: a big scary prompt when loading the system DB is a bit heavy-handed, no? 
     */
    canActivate(args: any): any {
        var self = this;
        setTimeout(() => viewModelBase.showSplash(self.isAttached === false), 700);
        this.downloader.reset();

        var resource = appUrl.getResource();
        if (resource && resource.disabled()) {
            messagePublisher.reportError(`${resource.fullTypeName} '${resource.name}' is disabled!`,
                `You can't access any section of the ${resource.fullTypeName.toLowerCase()} while it's disabled.`);

        }

        return true;
    }

    /*
     * Called by Durandal when the view model is loaded and before the view is inserted into the DOM.
     */
    activate(args: any, isShell = false) {
        var db = appUrl.getDatabase();
        var currentDb = this.activeDatabase();
        if (!!db && (!currentDb || currentDb.name !== db.name)) {
            ko.postbox.publish("ActivateDatabaseWithName", db.name);
        }

        // create this ko.computed once to avoid creation and subscribing every 50 ms - thus creating memory leak.
        var adminArea = this.appUrls.isAreaActive("admin");

        oauthContext.enterApiKeyTask.done(() => {
            // we have to wait for changes api to connect as well
            // as obtaining changes api connection might take a while, we have to spin until connection is read
            var createNotifySpinFunction = () => {
                if (isShell || adminArea())
                    return;
                if (changesContext.currentResourceChangesApi && changesContext.currentResourceChangesApi()) {
                    this.notifications = this.createNotifications();
                } else {
                    setTimeout(createNotifySpinFunction, 50);
                }
            }
            createNotifySpinFunction();
        });

        this.postboxSubscriptions = this.createPostboxSubscriptions();
        this.modelPollingStart();


        ko.postbox.publish("SetRawJSONUrl", "");
        this.updateHelpLink(null); // clean link
    }

    attached() {
        window.addEventListener("beforeunload", this.beforeUnloadListener, false);
        this.isAttached = true;
        viewModelBase.showSplash(false);
        this.rightPanelSetup();
    }

    private rightPanelSetup() {
        var $pageHostRoot = $("#page-host-root");
        var hasRightPanel = !!$("#right-options-panel", $pageHostRoot).length;
        $pageHostRoot.toggleClass("enable-right-options-panel", hasRightPanel);
    }

    /*
     * Called by Durandal when the view model is loaded and after the view is inserted into the DOM.
     */
    compositionComplete() {
        this.dirtyFlag().reset(); //Resync Changes
    }

    /*
     * Called by Durandal before deactivate in order to determine whether removing from the DOM is necessary.
     */
    canDeactivate(isClose: boolean): any {
        var isDirty = this.dirtyFlag().isDirty();
        if (isDirty) {
            var discard = "Discard changes";
            var stay = "Stay on this page";
            var discardStayResult = $.Deferred();
            var confirmation = this.confirmationMessage("Unsaved changes", "You have unsaved changes. How do you want to proceed?", [discard, stay], true);
            confirmation.done((result: { can: boolean; }) => {
                if (!result.can) {
                    this.dirtyFlag().reset();    
                }
                result.can = !result.can;
                discardStayResult.resolve(result);
            });

            return discardStayResult;
        }

        return true;
    }

    /*
     * Called by Durandal when the view model is unloaded and after the view is removed from the DOM.
     */
    detached() {
        this.currentHelpLink.unsubscribeFrom("currentHelpLink");
        this.cleanupNotifications();
        this.cleanupPostboxSubscriptions();

        window.removeEventListener("beforeunload", this.beforeUnloadListener, false);

        this.isAttached = true;
        viewModelBase.showSplash(false);
    }

    /*
     * Called by Durandal when the view model is unloading and the view is about to be removed from the DOM.
     */
    deactivate() {
        this.keyboardShortcutDomContainers.forEach(el => this.removeKeyboardShortcuts(el));
        this.modelPollingStop();

        this.isAttached = true;
        viewModelBase.showSplash(false);
    }

    createNotifications(): Array<changeSubscription> {
        return [];
    }

    cleanupNotifications() {
        //TODO: this.notifications.forEach((notification: changeSubscription) => notification.off());
        this.notifications = [];
    }

    createPostboxSubscriptions(): Array<KnockoutSubscription> {
        return [];
    }

    cleanupPostboxSubscriptions() {
        this.postboxSubscriptions.forEach((subscription: KnockoutSubscription) => subscription.dispose());
        this.postboxSubscriptions = [];
    }

    /*
     * Creates a keyboard shortcut local to the specified element and its children.
     * The shortcut will be removed as soon as the view model is deactivated.
     * Also defines shortcut for ace editor, if ace editor was received
     */
    createKeyboardShortcut(keys: string, handler: () => void, elementSelector: string) {
        jwerty.key(keys, e => {
            e.preventDefault();
            handler();
        }, this, elementSelector);

        if (!this.keyboardShortcutDomContainers.contains(elementSelector)) {
            this.keyboardShortcutDomContainers.push(elementSelector);
        }
    }

    private removeKeyboardShortcuts(elementSelector: string) {
        $(elementSelector).unbind('keydown.jwerty');
    }

    /*
     * Navigates to the specified URL, recording a navigation event in the browser's history.
     */
    navigate(url: string) {
        router.navigate(url);
    }

    /*
     * Navigates by replacing the current URL. It does not record a new entry in the browser's navigation history.
     */
    updateUrl(url: string) {
        var options: DurandalNavigationOptions = {
            replace: true,
            trigger: false
        };
        router.navigate(url, options);
    }

    modelPolling(): JQueryPromise<any> {
        return null;
    }

    pollingWithContinuation() {
        var poolPromise = this.modelPolling();
        if (poolPromise) {
            poolPromise.always(() => {
                viewModelBase.modelPollingHandle = setTimeout(() => {
                    viewModelBase.modelPollingHandle = null;
                    this.pollingWithContinuation();
                    }, 5000);
            });
        }
    }

    modelPollingStart() {
        // clear previous pooling handle (if any)
        if (viewModelBase.modelPollingHandle) {
            this.modelPollingStop();
        }
        this.pollingWithContinuation();
       
    }

    modelPollingStop() {
        clearTimeout(viewModelBase.modelPollingHandle);
        viewModelBase.modelPollingHandle = null;
    }

    confirmationMessage(title: string, confirmationMessage: string, options: string[]= ["No", "Yes"], forceRejectWithResolve: boolean = false): JQueryPromise<any> {
        var viewTask = $.Deferred();
        var confirmTask = app.showDialog(new confirmationDialog(confirmationMessage, title, options));

        confirmTask.done((answer) => {
            var isConfirmed = answer === options.last();
            if (isConfirmed) {
                viewTask.resolve({ can: true });
            } else if (!forceRejectWithResolve) {
                viewTask.reject();
            } else {
                viewTask.resolve({ can: false });
            }
        });

        return viewTask;
    }

    canContinueIfNotDirty(title: string, confirmationMessage: string) {
        var deferred = $.Deferred<void>();

        var isDirty = this.dirtyFlag().isDirty();
        if (isDirty) {
            var confirmationMessageViewModel = this.confirmationMessage(title, confirmationMessage);
            confirmationMessageViewModel.done(() => deferred.resolve());
        } else {
            deferred.resolve();
        }

        return deferred;
    }

    private beforeUnloadListener: EventListener = (e: any): any => {
        var isDirty = this.dirtyFlag().isDirty();
        if (isDirty) {
            var message = "You have unsaved data.";
            e = e || window.event;

            // For IE and Firefox
            if (e) {
                e.returnValue = message;
            }

            // For Safari
            return message;
        }
    }

    public addNotification(subscription: changeSubscription) {
        this.notifications.push(subscription);
    }

    public removeNotification(subscription: changeSubscription) {
        this.notifications.remove(subscription);
    }

    public continueTest() {
        var doc = document.empty();
        new saveDocumentCommand("Debug/Done", doc, this.activeDatabase(), false)
            .execute()
            .done(() => viewModelBase.hasContinueTestOption(false));
    }

    public updateHelpLink(hash: string = null) {
        if (hash) {
            var version = viewModelBase.clientVersion();
            if (version) {
                var href = "http://ravendb.net/l/" + hash + "/" + version + "/";
                ko.postbox.publish('globalHelpLink', href);
                return;
            }

            var subscribtion = viewModelBase.clientVersion.subscribe(v => {
                var href = "http://ravendb.net/l/" + hash + "/" + v + "/";
                ko.postbox.publish('globalHelpLink', href);

                if (subscribtion) {
                    subscribtion.dispose();
                }
            });
        } else {
            ko.postbox.publish('globalHelpLink', null);
        }
    }

    
}

export = viewModelBase;
