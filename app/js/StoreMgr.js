/*
 * Copyright (c) 2015, salesforce.com, inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided
 * that the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice, this list of conditions and the
 * following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
 * the following disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * Neither the name of salesforce.com, inc. nor the names of its contributors may be used to endorse or
 * promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
 * PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
'use strict';

var EventEmitter = require('./events');
var smartstore = require('./react.force.smartstore');
var smartsync = require('./react.force.smartsync');

function ObjectStore(options) {
    this.syncInFlight = false;
    this.syncDownId;
    this.lastStoreQuerySent = 0;
    this.lastStoreResponseReceived = 0;
    this.eventEmitter = new EventEmitter();
    this.SMARTSTORE_CHANGED = "smartstoreChanged";
    //Setting the needed values in the DataStore
    this.fieldlist = options.fieldlist;
    this.objectName = options.objectName;
    this.soupName = options.soupName;
    this.recordLimit = options.soupName || 10000;
}

ObjectStore.prototype.emitSmartStoreChanged = function() {
    this.eventEmitter.emit(this.SMARTSTORE_CHANGED, {});
}

ObjectStore.prototype.syncDown = function(callback) {
    if (this.syncInFlight) {
        console.log("Not starting syncDown - sync already in fligtht");
        return;
    }
    console.log("Starting syncDown");

    this.syncInFlight = true;
    var fields = this.fieldlist.slice(0);
    fields.push("Id");
    fields.push("LastModifiedDate");
    var target = {
        type: "soql",
        query: "SELECT " + fields.join(",") + " FROM " + this.objectName + " LIMIT " + this.recordLimit
    };
    smartsync.syncDown(false,
        target,
        this.soupName, {
            mergeMode: smartsync.MERGE_MODE.OVERWRITE
        },
        (sync) => {
            this.syncInFlight = false;
            this.syncDownId = sync._soupEntryId;
            console.log("sync==>" + sync);
            this.emitSmartStoreChanged();
            if (callback) callback(sync);
        },
        (error) => {
            this.syncInFlight = false;
        }
    );
}

ObjectStore.prototype.reSync = function(callback) {
    if (this.syncInFlight) {
        console.log("Not starting reSync - sync already in fligtht");
        return;
    }

    console.log("Starting reSync");
    this.syncInFlight = true;
    smartsync.reSync(false,
        this.syncDownId,
        (sync) => {
            this.syncInFlight = false;
            this.emitSmartStoreChanged();
            if (callback) callback(sync);
        },
        (error) => {
            this.syncInFlight = false;
        }
    );
}

ObjectStore.prototype.syncUp = function(callback) {
    if (this.syncInFlight) {
        console.log("Not starting syncUp - sync already in fligtht");
        return;
    }

    console.log("Starting syncUp");
    this.syncInFlight = true;
    var fieldlist = ["FirstName", "LastName", "Title", "Email", "MobilePhone", "Department", "HomePhone"];
    smartsync.syncUp(false, {},
        this.soupName, {
            mergeMode: smartsync.MERGE_MODE.OVERWRITE,
            fieldlist: fieldlist
        },
        (sync) => {
            this.syncInFlight = false;
            if (callback) callback(sync);
        },
        (error) => {
            this.syncInFlight = false;
        }
    );
}

ObjectStore.prototype.syncData = function() {
    smartstore.registerSoup(false,
        this.soupName, [{
            path: "Id",
            type: "string"
        }, {
            path: "FirstName",
            type: "full_text"
        }, {
            path: "LastName",
            type: "full_text"
        }, {
            path: "__local__",
            type: "string"
        }],
        () => this.syncDown()
    );
}

ObjectStore.prototype.reSyncData = function() {
    this.syncUp(() => this.reSync());
}

ObjectStore.prototype.addStoreChangeListener = function(listener) {
    this.eventEmitter.addListener(this.SMARTSTORE_CHANGED, listener);
}

ObjectStore.prototype.saveContact = function(contact, callback) {
    smartstore.upsertSoupEntries(false, "contacts", [contact],
        () => {
            callback();
            this.emitSmartStoreChanged();
        });
}

ObjectStore.prototype.addContact = function(successCallback, errorCallback) {
    var contact = {
        Id: "local_" + (new Date()).getTime(),
        FirstName: null,
        LastName: null,
        Title: null,
        Email: null,
        MobilePhone: null,
        HomePhone: null,
        Department: null,
        attributes: {
            type: "Contact"
        },
        __locally_created__: true,
        __locally_updated__: false,
        __locally_deleted__: false,
        __local__: true
    };
    smartstore.upsertSoupEntries(false, this.soupName, [contact],
        (contacts) => successCallback(contacts[0]),
        errorCallback);
}

ObjectStore.prototype.deleteContact = function(contact, successCallback, errorCallback) {
    console.log('Deletig contact');
    smartstore.removeFromSoup(false, this.soupName, [contact._soupEntryId],
        successCallback,
        errorCallback);
}

ObjectStore.prototype.searchContacts = function(query, successCallback, errorCallback) {
    var querySpec;

    if (query === "") {
        querySpec = smartstore.buildAllQuerySpec("FirstName", "ascending", 100);
    } else {
        var queryParts = query.split(/ /);
        var queryFirst = queryParts.length == 2 ? queryParts[0] : query;
        var queryLast = queryParts.length == 2 ? queryParts[1] : query;
        var queryOp = queryParts.length == 2 ? "AND" : "OR";
        var match = "{contacts:FirstName}:" + queryFirst + "* " + queryOp + " {contacts:LastName}:" + queryLast + "*";
        querySpec = smartstore.buildMatchQuerySpec(null, match, "ascending", 100, "LastName");
    }
    var that = this;

    this.lastStoreQuerySent++;
    var currentStoreQuery = this.lastStoreQuerySent;

    smartstore.querySoup(false,
        this.soupName,
        querySpec,
        (cursor) => {
            console.log("Response for #" + currentStoreQuery);
            if (currentStoreQuery > this.lastStoreResponseReceived) {
                this.lastStoreResponseReceived = currentStoreQuery;
                var contacts = cursor.currentPageOrderedEntries;
                successCallback(contacts, currentStoreQuery);
            } else {
                console.log("IGNORING Response for #" + currentStoreQuery);
            }
        },
        (error) => {
            console.log("Error->" + JSON.stringify(error));
            errorCallback(error);
        });
}

function contactStore(){
  return new ObjectStore({
    fieldlist : ["FirstName", "LastName", "Title", "Email", "MobilePhone", "Department", "HomePhone"],
    objectName : "Contact",
    soupName : "contacts"
  });
}

module.exports = {
    contactStore: contactStore
}
/*
module.exports = {
    syncData: syncData,
    reSyncData: reSyncData,
    addStoreChangeListener: addStoreChangeListener,
    saveContact: saveContact,
    searchContacts: searchContacts,
    addContact: addContact,
    deleteContact: deleteContact,
}*/
