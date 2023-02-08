/**
 * @license
 * Copyright The Closure Library Authors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Definition of the FancyWindow class. Please minimize
 * dependencies this file has on other closure classes as any dependency it
 * takes won't be able to use the logging infrastructure.
 *
 * This is a pretty hacky implementation, aimed at making debugging of large
 * applications more manageable.
 *
 * @see ../demos/debug.html
 */



// TODO(user): We're trying to migrate all ES5 subclasses of Closure
// Library to ES6. In ES6 this cannot be referenced before super is called. This
// file has at least one this before a super call (in ES5) and cannot be
// automatically upgraded to ES6 as a result. Please fix this if you have a
// chance. Note: This can sometimes be caused by not calling the super
// constructor at all. You can run the conversion tool yourself to see what it
// does on this file: blaze run //javascript/refactoring/es6_classes:convert.

goog.provide('goog.debug.FancyWindow');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.debug.DebugWindow');
goog.require('goog.dom.DomHelper');
goog.require('goog.dom.TagName');
goog.require('goog.dom.safe');
goog.require('goog.html.SafeHtml');
goog.require('goog.html.SafeStyleSheet');
goog.require('goog.log');
goog.require('goog.object');
goog.require('goog.string');
goog.require('goog.string.Const');
goog.require('goog.userAgent');



// TODO(mlourenco): Introduce goog.scope for goog.html.SafeHtml once b/12014412
// is fixed.
/**
 * Provides a Fancy extension to the DebugWindow class.  Allows filtering based
 * on loggers and levels.
 *
 * @param {string=} opt_identifier Idenitifier for this logging class.
 * @param {string=} opt_prefix Prefix pre-pended to messages.
 * @constructor
 * @extends {goog.debug.DebugWindow}
 */
goog.debug.FancyWindow = function(opt_identifier, opt_prefix) {
  'use strict';
  this.readOptionsFromLocalStorage_();
  goog.debug.FancyWindow.base(this, 'constructor', opt_identifier, opt_prefix);
  /** @private {?goog.dom.DomHelper} */
  this.dh_ = null;
};
goog.inherits(goog.debug.FancyWindow, goog.debug.DebugWindow);


/**
 * Constant indicating if we are able to use localStorage to persist filters
 * @type {boolean}
 */
goog.debug.FancyWindow.HAS_LOCAL_STORE = (function() {
  'use strict';
  try {
    return !!window['localStorage'].getItem;
  } catch (e) {
  }
  return false;
})();


/**
 * Constant defining the prefix to use when storing log levels
 * @type {string}
 */
goog.debug.FancyWindow.LOCAL_STORE_PREFIX = 'fancywindow.sel.';


/** @override */
goog.debug.FancyWindow.prototype.writeBufferToLog = function() {
  'use strict';
  this.lastCall = goog.now();
  if (this.hasActiveWindow()) {
    var logel = /** @type {!HTMLElement} */ (this.dh_.getElement('log'));

    // Work out if scrolling is needed before we add the content
    var scroll =
        logel.scrollHeight - (logel.scrollTop + logel.offsetHeight) <= 100;

    for (var i = 0; i < this.outputBuffer.length; i++) {
      var div = this.dh_.createDom(goog.dom.TagName.DIV, 'logmsg');
      goog.dom.safe.setInnerHtml(div, this.outputBuffer[i]);
      logel.appendChild(div);
    }
    this.outputBuffer.length = 0;
    this.resizeStuff_();

    if (scroll) {
      logel.scrollTop = logel.scrollHeight;
    }
  }
};


/** @override */
goog.debug.FancyWindow.prototype.writeInitialDocument = function() {
  'use strict';
  if (!this.hasActiveWindow()) {
    return;
  }

  var doc = this.win.document;
  doc.open();
  goog.dom.safe.documentWrite(doc, this.getHtml_());
  doc.close();

  (goog.userAgent.IE ? doc.body : this.win).onresize =
      goog.bind(this.resizeStuff_, this);

  // Create a dom helper for the logging window
  this.dh_ = new goog.dom.DomHelper(doc);

  // Don't use events system to reduce dependencies
  this.dh_.getElement('openbutton').onclick =
      goog.bind(this.openOptions_, this);
  this.dh_.getElement('closebutton').onclick =
      goog.bind(this.closeOptions_, this);
  this.dh_.getElement('clearbutton').onclick = goog.bind(this.clear, this);
  this.dh_.getElement('exitbutton').onclick = goog.bind(this.exit_, this);

  this.writeSavedMessages();
};


/**
 * Show the options menu.
 * @return {boolean} false.
 * @private
 */
goog.debug.FancyWindow.prototype.openOptions_ = function() {
  'use strict';
  var el = goog.asserts.assert(this.dh_.getElement('optionsarea'));
  goog.dom.safe.setInnerHtml(el, goog.html.SafeHtml.EMPTY);

  var loggers = goog.debug.FancyWindow.getLoggers_();
  var dh = this.dh_;
  for (var i = 0; i < loggers.length; i++) {
    var logger = loggers[i];
    var curlevel =
        goog.log.getLevel(logger) ? goog.log.getLevel(logger).name : 'INHERIT';
    var div = dh.createDom(
        goog.dom.TagName.DIV, {},
        this.getDropDown_('sel' + logger.getName(), curlevel),
        dh.createDom(goog.dom.TagName.SPAN, {}, logger.getName() || '(root)'));
    el.appendChild(div);
  }

  this.dh_.getElement('options').style.display = 'block';
  return false;
};


/**
 * Make a drop down for the log levels.
 * @param {string} id Logger id.
 * @param {string} selected What log level is currently selected.
 * @return {!Element} The newly created 'select' DOM element.
 * @private
 */
goog.debug.FancyWindow.prototype.getDropDown_ = function(id, selected) {
  'use strict';
  var dh = this.dh_;
  var sel = dh.createDom(goog.dom.TagName.SELECT, {'id': id});
  var levels = goog.log.Level.PREDEFINED_LEVELS;
  for (var i = 0; i < levels.length; i++) {
    var level = levels[i];
    var option = dh.createDom(goog.dom.TagName.OPTION, {}, level.name);
    if (selected == level.name) {
      option.selected = true;
    }
    sel.appendChild(option);
  }
  sel.appendChild(
      dh.createDom(
          goog.dom.TagName.OPTION, {'selected': selected == 'INHERIT'},
          'INHERIT'));
  return sel;
};


/**
 * Close the options menu.
 * @return {boolean} The value false.
 * @private
 */
goog.debug.FancyWindow.prototype.closeOptions_ = function() {
  'use strict';
  this.dh_.getElement('options').style.display = 'none';
  var loggers = goog.debug.FancyWindow.getLoggers_();
  var dh = this.dh_;
  for (var i = 0; i < loggers.length; i++) {
    var logger = loggers[i];
    var sel = /** @type {!HTMLSelectElement} */ (
        dh.getElement('sel' + logger.getName()));
    var level = sel.options[sel.selectedIndex].text;
    if (level == 'INHERIT') {
      goog.log.setLevel(logger, null);
    } else {
      goog.log.setLevel(logger, goog.log.Level.getPredefinedLevel(level));
    }
  }
  this.writeOptionsToLocalStorage_();
  return false;
};


/**
 * Resizes the log elements
 * @private
 */
goog.debug.FancyWindow.prototype.resizeStuff_ = function() {
  'use strict';
  var dh = this.dh_;
  var logel = /** @type {!HTMLElement} */ (dh.getElement('log'));
  var headel = /** @type {!HTMLElement} */ (dh.getElement('head'));
  logel.style.top = headel.offsetHeight + 'px';
  logel.style.height = (dh.getDocument().body.offsetHeight -
                        headel.offsetHeight - (goog.userAgent.IE ? 4 : 0)) +
      'px';
};


/**
 * Handles the user clicking the exit button, disabled the debug window and
 * closes the popup.
 * @param {Event} e Event object.
 * @private
 */
goog.debug.FancyWindow.prototype.exit_ = function(e) {
  'use strict';
  this.setEnabled(false);
  if (this.win) {
    this.win.close();
  }
};


/** @override */
goog.debug.FancyWindow.prototype.getStyleRules = function() {
  'use strict';
  var baseRules = goog.debug.FancyWindow.base(this, 'getStyleRules');
  var extraRules = goog.html.SafeStyleSheet.fromConstant(
      goog.string.Const.from(
          'html,body{height:100%;width:100%;margin:0px;padding:0px;' +
          'background-color:#FFF;overflow:hidden}' +
          '*{}' +
          '.logmsg{border-bottom:1px solid #CCC;padding:2px;font:90% monospace}' +
          '#head{position:absolute;width:100%;font:x-small arial;' +
          'border-bottom:2px solid #999;background-color:#EEE;}' +
          '#head p{margin:0px 5px;}' +
          '#log{position:absolute;width:100%;background-color:#FFF;}' +
          '#options{position:absolute;right:0px;width:50%;height:100%;' +
          'border-left:1px solid #999;background-color:#DDD;display:none;' +
          'padding-left: 5px;font:normal small arial;overflow:auto;}' +
          '#openbutton,#closebutton{text-decoration:underline;color:#00F;cursor:' +
          'pointer;position:absolute;top:0px;right:5px;font:x-small arial;}' +
          '#clearbutton{text-decoration:underline;color:#00F;cursor:' +
          'pointer;position:absolute;top:0px;right:80px;font:x-small arial;}' +
          '#exitbutton{text-decoration:underline;color:#00F;cursor:' +
          'pointer;position:absolute;top:0px;right:50px;font:x-small arial;}' +
          'select{font:x-small arial;margin-right:10px;}' +
          'hr{border:0;height:5px;background-color:#8c8;color:#8c8;}'));
  return goog.html.SafeStyleSheet.concat(baseRules, extraRules);
};


/**
 * Return the default HTML for the debug window
 * @return {!goog.html.SafeHtml} Html.
 * @private
 */
goog.debug.FancyWindow.prototype.getHtml_ = function() {
  'use strict';
  var SafeHtml = goog.html.SafeHtml;
  var head = SafeHtml.create(
      'head', {},
      SafeHtml.concat(
          SafeHtml.create('title', {}, 'Logging: ' + this.identifier),
          SafeHtml.createStyle(this.getStyleRules())));

  var body = SafeHtml.create(
      'body', {},
      SafeHtml.concat(
          SafeHtml.create(
              'div',
              {'id': 'log', 'style': goog.string.Const.from('overflow:auto')}),
          SafeHtml.create(
              'div', {'id': 'head'},
              SafeHtml.concat(
                  SafeHtml.create(
                      'p', {},
                      SafeHtml.create('b', {}, 'Logging: ' + this.identifier)),
                  SafeHtml.create('p', {}, this.welcomeMessage),
                  SafeHtml.create('span', {'id': 'clearbutton'}, 'clear'),
                  SafeHtml.create('span', {'id': 'exitbutton'}, 'exit'),
                  SafeHtml.create('span', {'id': 'openbutton'}, 'options'))),
          SafeHtml.create(
              'div', {'id': 'options'},
              SafeHtml.concat(
                  SafeHtml.create(
                      'big', {}, SafeHtml.create('b', {}, 'Options:')),
                  SafeHtml.create('div', {'id': 'optionsarea'}),
                  SafeHtml.create(
                      'span', {'id': 'closebutton'}, 'save and close')))));

  return SafeHtml.create('html', {}, SafeHtml.concat(head, body));
};


/**
 * Write logger levels to localStorage if possible.
 * @private
 */
goog.debug.FancyWindow.prototype.writeOptionsToLocalStorage_ = function() {
  'use strict';
  if (!goog.debug.FancyWindow.HAS_LOCAL_STORE) {
    return;
  }
  var loggers = goog.debug.FancyWindow.getLoggers_();
  var storedKeys = goog.debug.FancyWindow.getStoredKeys_();
  for (var i = 0; i < loggers.length; i++) {
    var key = goog.debug.FancyWindow.LOCAL_STORE_PREFIX + loggers[i].getName();
    var level = goog.log.getLevel(loggers[i]);
    if (key in storedKeys) {
      if (!level) {
        window.localStorage.removeItem(key);
      } else if (window.localStorage.getItem(key) != level.name) {
        window.localStorage.setItem(key, level.name);
      }
    } else if (level) {
      window.localStorage.setItem(key, level.name);
    }
  }
};


/**
 * Sync logger levels with any values stored in localStorage.
 * @private
 */
goog.debug.FancyWindow.prototype.readOptionsFromLocalStorage_ = function() {
  'use strict';
  if (!goog.debug.FancyWindow.HAS_LOCAL_STORE) {
    return;
  }
  var storedKeys = goog.debug.FancyWindow.getStoredKeys_();
  for (var key in storedKeys) {
    var loggerName = key.replace(goog.debug.FancyWindow.LOCAL_STORE_PREFIX, '');
    var logger = goog.log.getLogger(loggerName);
    var curLevel = goog.log.getLevel(logger);
    var storedLevel = window.localStorage.getItem(key).toString();
    if (!curLevel || curLevel.toString() != storedLevel) {
      goog.log.setLevel(logger, goog.log.Level.getPredefinedLevel(storedLevel));
    }
  }
};


/**
 * Helper function to create a list of locally stored keys. Used to avoid
 * expensive localStorage.getItem() calls.
 * @return {!Object} List of keys.
 * @private
 */
goog.debug.FancyWindow.getStoredKeys_ = function() {
  'use strict';
  var storedKeys = {};
  for (var i = 0, len = window.localStorage.length; i < len; i++) {
    var key = window.localStorage.key(i);
    if (key != null &&
        goog.string.startsWith(
            key, goog.debug.FancyWindow.LOCAL_STORE_PREFIX)) {
      storedKeys[key] = true;
    }
  }
  return storedKeys;
};


/**
 * Gets a sorted array of all the loggers registered.
 * @return {!Array<!goog.log.Logger>} Array of logger instances.
 * @private
 */
goog.debug.FancyWindow.getLoggers_ = function() {
  'use strict';
  const loggers = goog.log.getAllLoggers();

  /**
   * @param {!goog.log.Logger} a
   * @param {!goog.log.Logger} b
   * @return {number}
   */
  const loggerSort = (a, b) => {
    'use strict';
    return goog.array.defaultCompare(a.getName(), b.getName());
  };
  goog.array.sort(loggers, loggerSort);
  return loggers;
};
