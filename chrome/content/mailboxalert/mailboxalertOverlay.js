//
// Copyright 2012, Jelte Jansen
// BSD licensed, see LICENSE for details
//

//
// This file contains general setup code, and code to hook into
// Thunderbird's messaging system.
//

MailboxAlert.getFolder = function () {
        try {
                var folderResource = GetFirstSelectedMsgFolder();
                if (folderResource)
                {
                        var msgFolder = MailboxAlert.getInterface(folderResource, Components.interfaces.nsIMsgFolder);
                        return msgFolder;
                }
        } catch (ex) {
                MailboxAlertUtil.logMessage(1, "ex="+ex+"\n");
        }
        MailboxAlertUtil.logMessage(1, "error: folder not found\n");
        return null;
}

MailboxAlert.toggleMute = function () {
    var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
    var muted = true;
    try {
        muted = !prefs.getBoolPref("extensions.mailboxalert.mute");
    }
    catch (e) {
        // Ignore, mute never saved
    }
    prefs.setBoolPref("extensions.mailboxalert.mute", muted);
    /* should we check whether the user has made the mute state out of sync, by
     toggling mute in different windows? */
    /* window_muted = menuitem.hasAttribute("checked");*/
    MailboxAlert.setMuteMenuitem(muted);
}

MailboxAlert.muted = function() {
    var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
    var muted = false;
    try {
        muted = prefs.getBoolPref("extensions.mailboxalert.mute");
    }
    catch (e) {
        // Ignore, mute never saved
    }
    return muted;
}

MailboxAlert.setMuteMenuitem = function(muted) {
    var menuitem = document.getElementById("mailboxalert-moz-tools-menu-mute");
    if (muted) {
        menuitem.setAttribute("checked", true);
    } else {
        menuitem.removeAttribute("checked");
    }
}

MailboxAlert.checkOldSettings = function () {
    // get the value for 'prefsversion'. If it doesn't exist, assume
    // (0.)14. If it is 14, call conversion routines.
    var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
    var prefsversion;
    try {
        prefsversion = prefs.getIntPref("extensions.mailboxalert.prefsversion");
    } catch (e) {
        // ok, it doesn't exist yet, assume 14
        prefsversion = 14;
    }
    if (prefsversion < 15) {
        MailboxAlert.convertAllFolderPreferences14toAlertPreferences();
        prefs.setIntPref("extensions.mailboxalert.prefsversion", 15);
    }
}

// Alert Queue
//
// Since items may be moved by custom filters shortly after they were
// added, and there does not appear to be a general event to signal
// the message has been filed, we store a queue of alerts to run

// If a message arrives, a queue entry is created with info about
// the folder it arrived in and the message header itself.
//
// A timer is started.
// Between the start and firing of the alert, a number of things can happen
// 1. nothing happens
// 2. another message arrives for this folder
// 3. the message gets moved to another folder
// 4. Both 2 and 3
//
// 1. If nothing happens, just remove the item from the queue and fire the
//    alert
// 2. If another message arrives, we want to cancel the original one, and
//    replace it with one for the new message (so we don't fire for all
//    new messages). This message itself could be moved, so we need to
//    reset the timer.
// 3. If the message is moved, we need to start a new timer for the new
//    folder, and remove the old. If the old was a replacement for another
//    message (which has not been fired yet), we should re-enable that one.
// 4. If both 2 and 3 happen, we need to fire for the new message, and for the
//    moved one.
//
// So we essentially need a set of timers and stacks; one timer and one stack
// per folder;
// When a new message signal arrives, we add it to the folder stack, and either
// start or reset the timer.
// If this message key is present in another folder stack, we need to remove
// it. If the stack is then empty, we need to cancel the folder's timer.
// When a timer fires, we run an alert for the last item in the associated
// folder's stack. We then remove the entire stack.
// If either happens and the stack is locked, we run a retry-timer;
// so we need an additional queue; for items that have yet to be added.

//

MailboxAlert.alertQueue = {};
MailboxAlert.alertQueue.entries = new Array();

// Add a (folder, item) object to the alertQueue.
// If the alert queue is locked, create an nsITimer callback option
// to add it as soon as the queue becomes unlocked (or until a number
// of attempts to get the lock has failed)
MailboxAlert.alertQueueItemAdder = function(folder, item) {
    var item_adder = {}
    item_adder.timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
    item_adder.folder = folder;
    item_adder.item = item;
    item_adder.attempts = 0;

    item_adder.notify = function(timer) {
        if (this.attempts > MailboxAlert.ATTEMPTS) {
            this.timer.cancel();
            return;
        }
        if (MailboxAlert.alertQueue.getLock()) {
            try {
                MailboxAlert.alertQueue.addItem(folder, item);
            } catch (e) {
                MailboxAlertUtil.logMessage(1, "Error while adding item to alert queue: " + e + "\n");
            }
            MailboxAlert.alertQueue.releaseLock();
        } else {
            item_adder.timer.initWithCallback(item_adder, MailboxAlert.WAIT_TIME, item_adder.timer.TYPE_ONE_SHOT);
        }
    }
    // Immediately fire it once
    item_adder.timer.initWithCallback(item_adder, 0, item_adder.timer.TYPE_ONE_SHOT);
}

MailboxAlert.alertQueue.getLock = function() {
    if (!this.locked) {
        this.locked = true;
        return true;
    } else {
        return false;
    }
}

MailboxAlert.alertQueue.releaseLock = function() {
    this.locked = false;
}

// This adds an entry to a stack, and removes it from any other queues it is in
// The queue must have been locked already.
MailboxAlert.alertQueue.addItem = function (folder, item) {
    var found = false;
    for (var i = 0; i < this.entries.length; i++) {
        var cur_entry = this.entries[i];
        if (cur_entry.folder == folder) {
            // Add to queue
            cur_entry.items.push(item);
            found = true;
            // Reset timer
            cur_entry.timer.cancel();
            cur_entry.timer.initWithCallback(cur_entry,
                                             MailboxAlert.INITIAL_WAIT_TIME,
                                             cur_entry.timer.TYPE_ONE_SHOT);
        } else {
            // Remove from any other queues
            var idx;

            // TB may have performed some cleanup already, so we might need to
            // do the same
            var items_to_keep = new Array();
            for (idx = 0; idx < cur_entry.items.length; idx++) {
                if (cur_entry.items[idx].messageId != "") {
                    items_to_keep.push(cur_entry.items[idx]);
                }
            }
            cur_entry.items = items_to_keep;

            // Now see if it is still present
            for (idx = cur_entry.items.length -1; idx >= -1; idx--) {
                if (idx == -1) {
                    break;
                }

                if (cur_entry.items[idx].messageId == item.messageId) {
                    break;
                }
            }
            if (idx != -1) {
                cur_entry.items.splice(idx, 1);
            }
            // If the entry now has no items, remove it from the queue
            if (cur_entry.items.length == 0) {
                cur_entry.timer.cancel();
                idx = this.entries.indexOf(cur_entry);
                if (idx != -1) {
                    this.entries.splice(idx, 1);
                }
            }
        }
    }
    if (!found) {
        // Create and entry and start the timer
        var new_entry = {};
        new_entry.folder = folder;
        new_entry.items = new Array();
        new_entry.items.push(item);
        new_entry.timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
        new_entry.notify = function(timer) {
            var folder = null;
            var alert_msg = null;
            if (MailboxAlert.alertQueue.getLock()) {
                try {
                    var idx = MailboxAlert.alertQueue.entries.indexOf(this);
                    folder = this.folder;
                    // popping it is no problem; we'll destroy this whole array anyway
                    alert_msg = this.items.pop();
                    MailboxAlert.alertQueue.entries.splice(idx, 1);
                } catch (e) {
                    MailboxAlertUtil.logMessage(1, "Error while adding item to alert queue: " + e + "\n");
                }
                MailboxAlert.alertQueue.releaseLock();
            } else {
                // try again in 100 ms
                this.timer.initWithCallback(new_entry, MailboxAlert.WAIT_TIME, new_entry.timer.TYPE_ONE_SHOT);
            }
            // Only alert if it hasn't already been read
            if (folder != null && alert_msg != null &&
                !alert_msg.isRead && alert_msg.messageId != "") {
                MailboxAlert.new_alert(folder, alert_msg);
            }
        }
        new_entry.timer.initWithCallback(new_entry, MailboxAlert.INITIAL_WAIT_TIME, new_entry.timer.TYPE_ONE_SHOT);
        this.entries.push(new_entry);
    }
}

MailboxAlert.FolderListener = function ()
{
    // empty constructor
}

MailboxAlert.FolderListener.prototype =
{
    OnItemAdded: function(parentItem, item)
    {
        const MSG_FOLDER_FLAG_OFFLINE = 0x8000000;

        var folder = MailboxAlert.getInterface(parentItem, Components.interfaces.nsIMsgFolder);
        var message;
        try {
            item.QueryInterface(Components.interfaces.nsIMsgDBHdr, message);
            MailboxAlert.alertQueue.addItem(folder, item);
        } catch (exception2) {
            MailboxAlertUtil.logMessage(1, "Exception: " + exception2 + "\n");
            MailboxAlertUtil.logMessage(1, "the item was: " + item + "\n");
        }
    }
}

MailboxAlert.onLoad = function ()
{
    // remove to avoid duplicate initialization
    removeEventListener("load", MailboxAlert.onLoad, true);

    //var notificationService =
    //Components.classes["@mozilla.org/messenger/msgnotificationservice;1"]
    //.getService(Components.interfaces.nsIMsgFolderNotificationService);

    //notificationService.addListener(MailboxAlert.newMailListener,
    //                                notificationService.msgsClassified);

    Components.classes["@mozilla.org/messenger/services/session;1"]
    .getService(Components.interfaces.nsIMsgMailSession)
    .AddFolderListener(new MailboxAlert.FolderListener(),
    Components.interfaces.nsIFolderListener.added);

    // with IMAP, the 'view' can be updated (i.e. new mail has arrived and
    // this is visible in the treeview), but the folder itself may not have
    // been, until the folder is clicked. In this case no 'real' state has
    // changed, and no notification would have been sent. So Mailbox Alert
    // needs the folder to be really updated, as if the user has selected
    // the folder (this happens for instance when procmail drops mail into
    // a subfolder)
    //Components.classes["@mozilla.org/messenger/services/session;1"]
    //.getService(Components.interfaces.nsIMsgMailSession)
    //.AddFolderListener(MailboxAlert.folderUpdater,
    //Components.interfaces.nsIFolderListener.intPropertyChanged);

    // check if there are old settings (pre 0.14) to copy
    MailboxAlert.checkOldSettings();

    // check if we exited with muted on last time
    MailboxAlert.setMuteMenuitem(MailboxAlert.muted());

    // And finally, add our shiny custom filter action
    var filterService = Components.classes["@mozilla.org/messenger/services/filters;1"]
                        .getService(Components.interfaces.nsIMsgFilterService);

    filterService.addCustomAction(MailboxAlert.filter_action);
}

addEventListener("load", MailboxAlert.onLoad, true);
