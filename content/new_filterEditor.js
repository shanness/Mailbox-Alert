/* This Source Code Form is subject to the terms of the Mozilla Public
  * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// This is loaded into all XUL windows. Wrap in a block to prevent
// leaking to window scope.
{
  class MailboxAlertRuleactiontargetBase extends MozXULElement { }

  const updateParentNode = (parentNode) => {
    MailboxAlertUtil.logMessage(5, "updateParentNode: " + parentNode.nodeName);
    let attrs = parentNode.attributes;
    for (let i=0; i<attrs.length; i++) {
      let item = attrs.item(i);
      MailboxAlertUtil.logMessage(5, "updateParentNode attr: " + item.nodeName);
    }
    if (parentNode.hasAttribute("initialActionIndex")) {
      let actionIndex = parentNode.getAttribute("initialActionIndex");
      MailboxAlertUtil.logMessage(5, "updateParentNode has initialActionIndex " + actionIndex);
      let filterAction = gFilter.getActionAt(actionIndex);
      MailboxAlertUtil.logMessage(5, "filterAction: " + filterAction);
      MailboxAlertUtil.logMessage(5, "updateParentNode call init with action");
      parentNode.initWithAction(filterAction);
    }
    MailboxAlertUtil.logMessage(5, "updateParentNode remove button");
    parentNode.updateRemoveButton();
  };

  const printNodeAttrsRecurse = (parentNode, i) => {
    MailboxAlertUtil.logMessage(5, "NodeAttrsRecurse node: " + i + ": " + parentNode.nodeName);
    let attrs = parentNode.attributes;
    for (let i=0; i<attrs.length; i++) {
      let item = attrs.item(i);
      MailboxAlertUtil.logMessage(5, "    attr: " + item.nodeName);
    }
    if (parentNode.parentNode) {
      printNodeAttrsRecurse(parentNode.parentNode, i+1)
    }
  };


class MozRuleactiontargetFilteralert extends MailboxAlertRuleactiontargetBase {
  connectedCallback() {
    if (this.delayConnectedCallback()) {
      return;
    }
    this.textContent = "";
    this.appendChild(MozXULElement.parseXULToFragment(`
      <menulist flex="1" class="ruleactionitem" inherits="disabled"
                onchange="this.parentNode.updateValue(this);"
                oncommand="this.parentNode.updateValue(this);"
      >
        <menupopup></menupopup>
      </menulist>
    `));

    //var alert_menu = document.getAnonymousNodes(this)[0].menupopup;
    let alert_menu = this.getElementsByTagName('menulist')[0];
    let value = alert_menu.value;
    let alert_menupopup= alert_menu.menupopup;
    let all_alerts = MailboxAlert.getAllAlertPrefs();
    for (var alert_i = 0; alert_i < all_alerts.length; ++alert_i) {
      let alert = all_alerts[alert_i];
      let alert_index = alert.index;
      let alert_menuitem = MailboxAlert.createMenuItem(alert.get("name"), alert_index);
      MailboxAlertUtil.logMessage(5, "add " + alert.get("name") + " to menu");
      alert_menupopup.appendChild(alert_menuitem);
    }
    updateParentNode(this.closest(".ruleaction"));

    // scan all menupopup items to find the uri for the selection
    printNodeAttrsRecurse(this, 0);
/*
    MailboxAlertUtil.logMessage(5, "original action?Value is " + this.value);
    let valueElements = alert_menupopup.getElementsByAttribute('value', value);
    if (valueElements && valueElements.length)
      alert_menu.selectedItem = valueElements[0];
    else
      alert_menu.selectedIndex = 0;
    this.value = alert_menu.selectedItem.getAttribute("value");
*/
  }
  
  updateValue(element) {
    MailboxAlertUtil.logMessage(5, "value changed");
    MailboxAlertUtil.logMessage(5, "value changed to " + element.value);
    MailboxAlertUtil.logMessage(5, "parent value was " + this.value);
    
    element.parentNode.setAttribute('value', element.value);
    element.parentNode.value=element.value;
    MailboxAlertUtil.logMessage(5, "parent value now " + this.value);
  }
}

function patchTarget() {
  MailboxAlertUtil.logMessage(5, "Start patchTarget()");
  let wrapper = customElements.get("ruleactiontarget-wrapper");
  if (!wrapper) {
      MailboxAlertUtil.logMessage(5, "no wrapper here");
      return;
  }
  // only want to patch it once
  let alreadyPatched = wrapper.prototype.hasOwnProperty("_MailboxAlertPatched") ?
                       wrapper.prototype._patchedByFiltaQuillaExtension :
                       false;
  if (alreadyPatched) {
    // already patched
    MailboxAlertUtil.logMessage(5, "Patch already run");
    return;
  }
  let prevMethod = wrapper.prototype._getChildNode;
  MailboxAlertUtil.logMessage(5, "prevMethod: " + prevMethod);
  if (prevMethod) {
    wrapper.prototype._getChildNode = function(type) {
      MailboxAlertUtil.logMessage(5, "Patch type: " + type);

      if (type == 'mailboxalert@tjeb.nl#mailboxalertfilter') {
        MailboxAlertUtil.logMessage(5, "Returning patched function");

        return document.createXULElement('ruleactiontarget-filteralert');
      } else {
        MailboxAlertUtil.logMessage(5, "Not patching this one");

        return prevMethod(type);
      }
    };
    wrapper.prototype._MailboxAlertPatched = true;
  }
  MailboxAlertUtil.logMessage(5, "Finish patchTarget()");
}

MailboxAlertUtil.logMessage(0, "filterstart");
customElements.define("ruleactiontarget-filteralert", MozRuleactiontargetFilteralert);
MailboxAlertUtil.logMessage(0, "patchtarget");
MailboxAlertUtil.logMessage(5, "patchtarget2");
patchTarget();
}
