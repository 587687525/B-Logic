/**
 * @license
 * Copyright The Closure Library Authors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Definition of the goog.ui.tree.BaseNode class.
 *
 *
 * This is a based on the webfx tree control. It since been updated to add
 * typeahead support, as well as accessibility support using ARIA framework.
 * See file comment in treecontrol.js.
 * @suppress {missingRequire} TODO(user): this shouldn't be needed
 */

goog.provide('goog.ui.tree.BaseNode');
goog.provide('goog.ui.tree.BaseNode.EventType');

goog.forwardDeclare('goog.ui.tree.TreeControl');
goog.require('goog.Timer');
goog.require('goog.a11y.aria');
goog.require('goog.a11y.aria.State');
goog.require('goog.asserts');
goog.require('goog.dom.safe');
goog.require('goog.events.Event');
goog.require('goog.events.KeyCodes');
goog.require('goog.html.SafeHtml');
goog.require('goog.html.SafeStyle');
goog.require('goog.string');
goog.require('goog.string.StringBuffer');
goog.require('goog.style');
goog.require('goog.ui.Component');
goog.requireType('goog.dom.DomHelper');
goog.requireType('goog.events.BrowserEvent');  // circular



/**
 * An abstract base class for a node in the tree.
 *
 * @param {string|!goog.html.SafeHtml} content The content of the node label.
 *     Strings are treated as plain-text and will be HTML escaped.
 * @param {Object=} opt_config The configuration for the tree. See
 *    {@link goog.ui.tree.BaseNode.defaultConfig}. If not specified the
 *    default config will be used.
 * @param {goog.dom.DomHelper=} opt_domHelper Optional DOM helper.
 * @constructor
 * @extends {goog.ui.Component}
 */
goog.ui.tree.BaseNode = function(content, opt_config, opt_domHelper) {
  'use strict';
  goog.ui.Component.call(this, opt_domHelper);

  /**
   * The configuration for the tree.
   * @type {Object}
   * @private
   */
  this.config_ = opt_config || goog.ui.tree.BaseNode.defaultConfig;

  /**
   * HTML content of the node label.
   * @type {!goog.html.SafeHtml}
   * @private
   */
  this.html_ = goog.html.SafeHtml.htmlEscapePreservingNewlines(content);

  /** @private {string} */
  this.iconClass_;

  /** @private {string} */
  this.expandedIconClass_;

  /** @protected {goog.ui.tree.TreeControl} */
  this.tree;

  /** @private {goog.ui.tree.BaseNode} */
  this.previousSibling_;

  /** @private {goog.ui.tree.BaseNode} */
  this.nextSibling_;

  /** @private {goog.ui.tree.BaseNode} */
  this.firstChild_;

  /** @private {goog.ui.tree.BaseNode} */
  this.lastChild_;

  /**
   * Whether the tree item is selected.
   * @private {boolean}
   */
  this.selected_ = false;

  /**
   * Whether the tree node is expanded.
   * @private {boolean}
   */
  this.expanded_ = false;

  /**
   * Tooltip for the tree item
   * @private {?string}
   */
  this.toolTip_ = null;

  /**
   * HTML that can appear after the label (so not inside the anchor).
   * @private {!goog.html.SafeHtml}
   */
  this.afterLabelHtml_ = goog.html.SafeHtml.EMPTY;

  /**
   * Whether to allow user to collapse this node.
   * @private {boolean}
   */
  this.isUserCollapsible_ = true;

  /**
   * Nesting depth of this node; cached result of computeDepth_.
   * -1 if value has not been cached.
   * @private {number}
   */
  this.depth_ = -1;
};
goog.inherits(goog.ui.tree.BaseNode, goog.ui.Component);


/**
 * The event types dispatched by this class.
 * @enum {string}
 */
goog.ui.tree.BaseNode.EventType = {
  BEFORE_EXPAND: 'beforeexpand',
  EXPAND: 'expand',
  BEFORE_COLLAPSE: 'beforecollapse',
  COLLAPSE: 'collapse'
};


/**
 * Map of nodes in existence. Needed to route events to the appropriate nodes.
 * Nodes are added to the map at {@link #enterDocument} time and removed at
 * {@link #exitDocument} time.
 * @type {Object}
 * @protected
 */
goog.ui.tree.BaseNode.allNodes = {};


/** @override */
goog.ui.tree.BaseNode.prototype.disposeInternal = function() {
  'use strict';
  goog.ui.tree.BaseNode.superClass_.disposeInternal.call(this);
  if (this.tree) {
    this.tree.removeNode(this);
    this.tree = null;
  }
  this.setElementInternal(null);
};


/**
 * Adds roles and states.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.initAccessibility = function() {
  'use strict';
  const el = this.getElement();
  if (el) {
    // Set an id for the label
    const label = this.getLabelElement();
    if (label && !label.id) {
      label.id = this.getId() + '.label';
    }

    goog.a11y.aria.setRole(el, 'treeitem');
    goog.a11y.aria.setState(el, 'selected', false);
    goog.a11y.aria.setState(el, 'level', this.getDepth());
    if (label) {
      goog.a11y.aria.setState(el, 'labelledby', label.id);
    }

    const img = this.getIconElement();
    if (img) {
      goog.a11y.aria.setRole(img, 'presentation');
    }
    const ei = this.getExpandIconElement();
    if (ei) {
      goog.a11y.aria.setRole(ei, 'presentation');
    }

    const ce = this.getChildrenElement();
    if (ce) {
      goog.a11y.aria.setRole(ce, 'group');

      // In case the children will be created lazily.
      if (ce.hasChildNodes()) {
        // Only set aria-expanded if the node has children (can be expanded).
        goog.a11y.aria.setState(el, goog.a11y.aria.State.EXPANDED, false);

        // do setsize for each child
        const count = this.getChildCount();
        for (let i = 1; i <= count; i++) {
          const child = this.getChildAt(i - 1).getElement();
          goog.asserts.assert(child, 'The child element cannot be null');
          goog.a11y.aria.setState(child, 'setsize', count);
          goog.a11y.aria.setState(child, 'posinset', i);
        }
      }
    }
  }
};


/** @override */
goog.ui.tree.BaseNode.prototype.createDom = function() {
  'use strict';
  const element = this.getDomHelper().safeHtmlToNode(this.toSafeHtml());
  this.setElementInternal(/** @type {!Element} */ (element));
};


/** @override */
goog.ui.tree.BaseNode.prototype.enterDocument = function() {
  'use strict';
  goog.ui.tree.BaseNode.superClass_.enterDocument.call(this);
  goog.ui.tree.BaseNode.allNodes[this.getId()] = this;
  this.initAccessibility();
};


/** @override */
goog.ui.tree.BaseNode.prototype.exitDocument = function() {
  'use strict';
  goog.ui.tree.BaseNode.superClass_.exitDocument.call(this);
  delete goog.ui.tree.BaseNode.allNodes[this.getId()];
};


/**
 * The method assumes that the child doesn't have parent node yet.
 * The `opt_render` argument is not used. If the parent node is expanded,
 * the child node's state will be the same as the parent's. Otherwise the
 * child's DOM tree won't be created.
 * @override
 */
goog.ui.tree.BaseNode.prototype.addChildAt = function(
    child, index, opt_render) {
  'use strict';
  goog.asserts.assert(!child.getParent());
  goog.asserts.assertInstanceof(child, goog.ui.tree.BaseNode);
  const prevNode = this.getChildAt(index - 1);
  const nextNode = this.getChildAt(index);

  goog.ui.tree.BaseNode.superClass_.addChildAt.call(this, child, index);

  child.previousSibling_ = prevNode;
  child.nextSibling_ = nextNode;

  if (prevNode) {
    prevNode.nextSibling_ = child;
  } else {
    this.firstChild_ = child;
  }
  if (nextNode) {
    nextNode.previousSibling_ = child;
  } else {
    this.lastChild_ = child;
  }

  const tree = this.getTree();
  if (tree) {
    child.setTreeInternal(tree);
  }

  child.setDepth_(this.getDepth() + 1);

  const el = this.getElement();
  if (el) {
    this.updateExpandIcon();
    goog.a11y.aria.setState(
        el, goog.a11y.aria.State.EXPANDED, this.getExpanded());
    if (this.getExpanded()) {
      const childrenEl = this.getChildrenElement();
      if (!child.getElement()) {
        child.createDom();
      }
      const childElement = child.getElement();
      const nextElement = nextNode && nextNode.getElement();
      childrenEl.insertBefore(/** @type {!Node} */ (childElement), nextElement);

      if (this.isInDocument()) {
        child.enterDocument();
      }

      if (!nextNode) {
        if (prevNode) {
          prevNode.updateExpandIcon();
        } else {
          goog.style.setElementShown(childrenEl, true);
          this.setExpanded(this.getExpanded());
        }
      }
    }
  }
};


/**
 * Adds a node as a child to the current node.
 * @param {goog.ui.tree.BaseNode} child The child to add.
 * @param {goog.ui.tree.BaseNode=} opt_before If specified, the new child is
 *    added as a child before this one. If not specified, it's appended to the
 *    end.
 * @return {!goog.ui.tree.BaseNode} The added child.
 */
goog.ui.tree.BaseNode.prototype.add = function(child, opt_before) {
  'use strict';
  goog.asserts.assert(
      !opt_before || opt_before.getParent() == this,
      'Can only add nodes before siblings');
  if (child.getParent()) {
    child.getParent().removeChild(child);
  }
  this.addChildAt(
      child, opt_before ? this.indexOfChild(opt_before) : this.getChildCount());
  return child;
};


/**
 * Removes a child. The caller is responsible for disposing the node.
 * @param {goog.ui.Component|string} childNode The child to remove. Must be a
 *     {@link goog.ui.tree.BaseNode}.
 * @param {boolean=} opt_unrender Unused. The child will always be unrendered.
 * @return {!goog.ui.tree.BaseNode} The child that was removed.
 * @override
 */
goog.ui.tree.BaseNode.prototype.removeChild = function(
    childNode, opt_unrender) {
  'use strict';
  // In reality, this only accepts BaseNodes.
  const child = /** @type {goog.ui.tree.BaseNode} */ (childNode);

  // if we remove selected or tree with the selected we should select this
  const tree = this.getTree();
  const selectedNode = tree ? tree.getSelectedItem() : null;
  if (selectedNode == child || child.contains(selectedNode)) {
    if (tree.hasFocus()) {
      this.select();
      goog.Timer.callOnce(this.onTimeoutSelect_, 10, this);
    } else {
      this.select();
    }
  }

  goog.ui.tree.BaseNode.superClass_.removeChild.call(this, child);

  if (this.lastChild_ == child) {
    this.lastChild_ = child.previousSibling_;
  }
  if (this.firstChild_ == child) {
    this.firstChild_ = child.nextSibling_;
  }
  if (child.previousSibling_) {
    child.previousSibling_.nextSibling_ = child.nextSibling_;
  }
  if (child.nextSibling_) {
    child.nextSibling_.previousSibling_ = child.previousSibling_;
  }

  const wasLast = child.isLastSibling();

  child.tree = null;
  child.depth_ = -1;

  if (tree) {
    // Tell the tree control that the child node is now removed.
    tree.removeNode(child);

    if (this.isInDocument()) {
      const childrenEl = this.getChildrenElement();

      if (child.isInDocument()) {
        const childEl = child.getElement();
        childrenEl.removeChild(/** @type {!Node} */ (childEl));

        child.exitDocument();
      }

      if (wasLast) {
        const newLast = this.getLastChild();
        if (newLast) {
          newLast.updateExpandIcon();
        }
      }
      if (!this.hasChildren()) {
        childrenEl.style.display = 'none';
        this.updateExpandIcon();
        this.updateIcon_();

        const el = this.getElement();
        if (el) {
          goog.a11y.aria.removeState(el, goog.a11y.aria.State.EXPANDED);
        }
      }
    }
  }

  return child;
};


/**
 * @deprecated Use {@link #removeChild}.
 */
goog.ui.tree.BaseNode.prototype.remove =
    goog.ui.tree.BaseNode.prototype.removeChild;


/**
 * Handler for setting focus asynchronously.
 * @private
 */
goog.ui.tree.BaseNode.prototype.onTimeoutSelect_ = function() {
  'use strict';
  this.select();
};


/**
 * Returns the tree.
 * @return {?goog.ui.tree.TreeControl}
 */
goog.ui.tree.BaseNode.prototype.getTree = goog.abstractMethod;


/**
 * Returns the depth of the node in the tree. Should not be overridden.
 * @return {number} The non-negative depth of this node (the root is zero).
 */
goog.ui.tree.BaseNode.prototype.getDepth = function() {
  'use strict';
  let depth = this.depth_;
  if (depth < 0) {
    depth = this.computeDepth_();
    this.setDepth_(depth);
  }
  return depth;
};


/**
 * Computes the depth of the node in the tree.
 * Called only by getDepth, when the depth hasn't already been cached.
 * @return {number} The non-negative depth of this node (the root is zero).
 * @private
 */
goog.ui.tree.BaseNode.prototype.computeDepth_ = function() {
  'use strict';
  const parent = this.getParent();
  if (parent) {
    return parent.getDepth() + 1;
  } else {
    return 0;
  }
};


/**
 * Changes the depth of a node (and all its descendants).
 * @param {number} depth The new nesting depth; must be non-negative.
 * @private
 */
goog.ui.tree.BaseNode.prototype.setDepth_ = function(depth) {
  'use strict';
  if (depth != this.depth_) {
    this.depth_ = depth;
    const row = this.getRowElement();
    if (row) {
      const indent = this.getPixelIndent_() + 'px';
      if (this.isRightToLeft()) {
        row.style.paddingRight = indent;
      } else {
        row.style.paddingLeft = indent;
      }
    }
    this.forEachChild(function(child) {
      'use strict';
      child.setDepth_(depth + 1);
    });
  }
};


/**
 * Returns true if the node is a descendant of this node
 * @param {goog.ui.tree.BaseNode} node The node to check.
 * @return {boolean} True if the node is a descendant of this node, false
 *    otherwise.
 */
goog.ui.tree.BaseNode.prototype.contains = function(node) {
  'use strict';
  let current = node;
  while (current) {
    if (current == this) {
      return true;
    }
    current = current.getParent();
  }
  return false;
};


/**
 * An array of empty children to return for nodes that have no children.
 * @type {!Array<!goog.ui.tree.BaseNode>}
 * @private
 */
goog.ui.tree.BaseNode.EMPTY_CHILDREN_ = [];


/**
 * @param {number} index 0-based index.
 * @return {goog.ui.tree.BaseNode} The child at the given index; null if none.
 */
goog.ui.tree.BaseNode.prototype.getChildAt;


/**
 * Returns the children of this node.
 * @return {!Array<!goog.ui.tree.BaseNode>} The children.
 */
goog.ui.tree.BaseNode.prototype.getChildren = function() {
  'use strict';
  const children = [];
  this.forEachChild(function(child) {
    'use strict';
    children.push(child);
  });
  return children;
};


/**
 * @return {goog.ui.tree.BaseNode} The first child of this node.
 */
goog.ui.tree.BaseNode.prototype.getFirstChild = function() {
  'use strict';
  return this.getChildAt(0);
};


/**
 * @return {goog.ui.tree.BaseNode} The last child of this node.
 */
goog.ui.tree.BaseNode.prototype.getLastChild = function() {
  'use strict';
  return this.getChildAt(this.getChildCount() - 1);
};


/**
 * @return {goog.ui.tree.BaseNode} The previous sibling of this node.
 */
goog.ui.tree.BaseNode.prototype.getPreviousSibling = function() {
  'use strict';
  return this.previousSibling_;
};


/**
 * @return {goog.ui.tree.BaseNode} The next sibling of this node.
 */
goog.ui.tree.BaseNode.prototype.getNextSibling = function() {
  'use strict';
  return this.nextSibling_;
};


/**
 * @return {boolean} Whether the node is the last sibling.
 */
goog.ui.tree.BaseNode.prototype.isLastSibling = function() {
  'use strict';
  return !this.nextSibling_;
};


/**
 * @return {boolean} Whether the node is selected.
 */
goog.ui.tree.BaseNode.prototype.isSelected = function() {
  'use strict';
  return this.selected_;
};


/**
 * Selects the node.
 */
goog.ui.tree.BaseNode.prototype.select = function() {
  'use strict';
  const tree = this.getTree();
  if (tree) {
    tree.setSelectedItem(this);
  }
};


/**
 * Originally it was intended to deselect the node but never worked.
 * @deprecated Use `tree.setSelectedItem(null)`.
 */
goog.ui.tree.BaseNode.prototype.deselect = goog.nullFunction;


/**
 * Called from the tree to instruct the node change its selection state.
 * @param {boolean} selected The new selection state.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.setSelectedInternal = function(selected) {
  'use strict';
  if (this.selected_ == selected) {
    return;
  }
  this.selected_ = selected;

  this.updateRow();

  const el = this.getElement();
  if (el) {
    goog.a11y.aria.setState(el, 'selected', selected);
    if (selected) {
      const treeElement = this.getTree().getElement();
      goog.asserts.assert(
          treeElement, 'The DOM element for the tree cannot be null');
      goog.a11y.aria.setState(treeElement, 'activedescendant', this.getId());
    }
  }
};


/**
 * @return {boolean} Whether the node is expanded.
 */
goog.ui.tree.BaseNode.prototype.getExpanded = function() {
  'use strict';
  return this.expanded_;
};


/**
 * Sets the node to be expanded internally, without state change events.
 * @param {boolean} expanded Whether to expand or close the node.
 */
goog.ui.tree.BaseNode.prototype.setExpandedInternal = function(expanded) {
  'use strict';
  this.expanded_ = expanded;
};


/**
 * Sets the node to be expanded.
 * @param {boolean} expanded Whether to expand or close the node.
 */
goog.ui.tree.BaseNode.prototype.setExpanded = function(expanded) {
  'use strict';
  const isStateChange = expanded != this.expanded_;
  if (isStateChange) {
    // Only fire events if the expanded state has actually changed.
    const prevented = !this.dispatchEvent(
        expanded ? goog.ui.tree.BaseNode.EventType.BEFORE_EXPAND :
                   goog.ui.tree.BaseNode.EventType.BEFORE_COLLAPSE);
    if (prevented) return;
  }
  let ce;
  this.expanded_ = expanded;
  const tree = this.getTree();
  const el = this.getElement();

  if (this.hasChildren()) {
    if (!expanded && tree && this.contains(tree.getSelectedItem())) {
      this.select();
    }

    if (el) {
      ce = this.getChildrenElement();
      if (ce) {
        goog.style.setElementShown(ce, expanded);
        goog.a11y.aria.setState(el, goog.a11y.aria.State.EXPANDED, expanded);

        // Make sure we have the HTML for the children here.
        if (expanded && this.isInDocument() && !ce.hasChildNodes()) {
          const children = [];
          this.forEachChild(function(child) {
            'use strict';
            children.push(child.toSafeHtml());
          });
          goog.dom.safe.setInnerHtml(ce, goog.html.SafeHtml.concat(children));
          this.forEachChild(function(child) {
            'use strict';
            child.enterDocument();
          });
        }
      }
      this.updateExpandIcon();
    }
  } else {
    ce = this.getChildrenElement();
    if (ce) {
      goog.style.setElementShown(ce, false);
    }
  }
  if (el) {
    this.updateIcon_();
  }

  if (isStateChange) {
    this.dispatchEvent(
        expanded ? goog.ui.tree.BaseNode.EventType.EXPAND :
                   goog.ui.tree.BaseNode.EventType.COLLAPSE);
  }
};


/**
 * Toggles the expanded state of the node.
 */
goog.ui.tree.BaseNode.prototype.toggle = function() {
  'use strict';
  this.setExpanded(!this.getExpanded());
};


/**
 * Expands the node.
 */
goog.ui.tree.BaseNode.prototype.expand = function() {
  'use strict';
  this.setExpanded(true);
};


/**
 * Collapses the node.
 */
goog.ui.tree.BaseNode.prototype.collapse = function() {
  'use strict';
  this.setExpanded(false);
};


/**
 * Collapses the children of the node.
 */
goog.ui.tree.BaseNode.prototype.collapseChildren = function() {
  'use strict';
  this.forEachChild(function(child) {
    'use strict';
    child.collapseAll();
  });
};


/**
 * Collapses the children and the node.
 */
goog.ui.tree.BaseNode.prototype.collapseAll = function() {
  'use strict';
  this.collapseChildren();
  this.collapse();
};


/**
 * Expands the children of the node.
 */
goog.ui.tree.BaseNode.prototype.expandChildren = function() {
  'use strict';
  this.forEachChild(function(child) {
    'use strict';
    child.expandAll();
  });
};


/**
 * Expands the children and the node.
 */
goog.ui.tree.BaseNode.prototype.expandAll = function() {
  'use strict';
  this.expandChildren();
  this.expand();
};


/**
 * Expands the parent chain of this node so that it is visible.
 */
goog.ui.tree.BaseNode.prototype.reveal = function() {
  'use strict';
  const parent = this.getParent();
  if (parent) {
    parent.setExpanded(true);
    parent.reveal();
  }
};


/**
 * Sets whether the node will allow the user to collapse it.
 * @param {boolean} isCollapsible Whether to allow node collapse.
 */
goog.ui.tree.BaseNode.prototype.setIsUserCollapsible = function(isCollapsible) {
  'use strict';
  this.isUserCollapsible_ = isCollapsible;
  if (!this.isUserCollapsible_) {
    this.expand();
  }
  if (this.getElement()) {
    this.updateExpandIcon();
  }
};


/**
 * @return {boolean} Whether the node is collapsible by user actions.
 */
goog.ui.tree.BaseNode.prototype.isUserCollapsible = function() {
  'use strict';
  return this.isUserCollapsible_;
};


/**
 * Creates HTML for the node.
 * @return {!goog.html.SafeHtml}
 * @protected
 */
goog.ui.tree.BaseNode.prototype.toSafeHtml = function() {
  'use strict';
  const tree = this.getTree();
  const hideLines = !tree.getShowLines() ||
      tree == this.getParent() && !tree.getShowRootLines();

  const childClass =
      hideLines ? this.config_.cssChildrenNoLines : this.config_.cssChildren;

  const nonEmptyAndExpanded = this.getExpanded() && this.hasChildren();

  const attributes = {'class': childClass, 'style': this.getLineStyle()};

  const content = [];
  if (nonEmptyAndExpanded) {
    // children
    this.forEachChild(function(child) {
      'use strict';
      content.push(child.toSafeHtml());
    });
  }

  const children = goog.html.SafeHtml.create('div', attributes, content);

  return goog.html.SafeHtml.create(
      'div', {'class': this.config_.cssItem, 'id': this.getId()},
      [this.getRowSafeHtml(), children]);
};


/**
 * @return {number} The pixel indent of the row.
 * @private
 */
goog.ui.tree.BaseNode.prototype.getPixelIndent_ = function() {
  'use strict';
  return Math.max(0, (this.getDepth() - 1) * this.config_.indentWidth);
};


/**
 * @return {!goog.html.SafeHtml} The html for the row.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getRowSafeHtml = function() {
  'use strict';
  const style = {};
  style['padding-' + (this.isRightToLeft() ? 'right' : 'left')] =
      this.getPixelIndent_() + 'px';
  const attributes = {'class': this.getRowClassName(), 'style': style};
  const content = [
    this.getExpandIconSafeHtml(), this.getIconSafeHtml(),
    this.getLabelSafeHtml()
  ];
  return goog.html.SafeHtml.create('div', attributes, content);
};


/**
 * @return {string} The class name for the row.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getRowClassName = function() {
  'use strict';
  let selectedClass;
  if (this.isSelected()) {
    selectedClass = ' ' + this.config_.cssSelectedRow;
  } else {
    selectedClass = '';
  }
  return this.config_.cssTreeRow + selectedClass;
};


/**
 * @return {!goog.html.SafeHtml} The html for the label.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getLabelSafeHtml = function() {
  'use strict';
  const html = goog.html.SafeHtml.create(
      'span',
      {'class': this.config_.cssItemLabel, 'title': this.getToolTip() || null},
      this.getSafeHtml());
  return goog.html.SafeHtml.concat(
      html,
      goog.html.SafeHtml.create('span', {}, this.getAfterLabelSafeHtml()));
};


/**
 * Returns the html that appears after the label. This is useful if you want to
 * put extra UI on the row of the label but not inside the anchor tag.
 * @return {string} The html.
 * @final
 */
goog.ui.tree.BaseNode.prototype.getAfterLabelHtml = function() {
  'use strict';
  return goog.html.SafeHtml.unwrap(this.getAfterLabelSafeHtml());
};


/**
 * Returns the html that appears after the label. This is useful if you want to
 * put extra UI on the row of the label but not inside the anchor tag.
 * @return {!goog.html.SafeHtml} The html.
 */
goog.ui.tree.BaseNode.prototype.getAfterLabelSafeHtml = function() {
  'use strict';
  return this.afterLabelHtml_;
};


/**
 * Sets the html that appears after the label. This is useful if you want to
 * put extra UI on the row of the label but not inside the anchor tag.
 * @param {!goog.html.SafeHtml} html The html.
 */
goog.ui.tree.BaseNode.prototype.setAfterLabelSafeHtml = function(html) {
  'use strict';
  this.afterLabelHtml_ = html;
  const el = this.getAfterLabelElement();
  if (el) {
    goog.dom.safe.setInnerHtml(el, html);
  }
};


/**
 * @return {!goog.html.SafeHtml} The html for the icon.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getIconSafeHtml = function() {
  'use strict';
  return goog.html.SafeHtml.create('span', {
    'style': {'display': 'inline-block'},
    'class': this.getCalculatedIconClass()
  });
};


/**
 * Gets the calculated icon class.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getCalculatedIconClass = goog.abstractMethod;


/**
 * @return {!goog.html.SafeHtml} The source for the icon.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getExpandIconSafeHtml = function() {
  'use strict';
  return goog.html.SafeHtml.create('span', {
    'type': 'expand',
    'style': {'display': 'inline-block'},
    'class': this.getExpandIconClass()
  });
};


/**
 * @return {string} The class names of the icon used for expanding the node.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getExpandIconClass = function() {
  'use strict';
  const tree = this.getTree();
  const hideLines = !tree.getShowLines() ||
      tree == this.getParent() && !tree.getShowRootLines();

  const config = this.config_;
  const sb = new goog.string.StringBuffer();
  sb.append(config.cssTreeIcon, ' ', config.cssExpandTreeIcon, ' ');

  if (this.hasChildren()) {
    let bits = 0;
    /*
      Bitmap used to determine which icon to use
      1  Plus
      2  Minus
      4  T Line
      8  L Line
    */

    if (tree.getShowExpandIcons() && this.isUserCollapsible_) {
      if (this.getExpanded()) {
        bits = 2;
      } else {
        bits = 1;
      }
    }

    if (!hideLines) {
      if (this.isLastSibling()) {
        bits += 4;
      } else {
        bits += 8;
      }
    }

    switch (bits) {
      case 1:
        sb.append(config.cssExpandTreeIconPlus);
        break;
      case 2:
        sb.append(config.cssExpandTreeIconMinus);
        break;
      case 4:
        sb.append(config.cssExpandTreeIconL);
        break;
      case 5:
        sb.append(config.cssExpandTreeIconLPlus);
        break;
      case 6:
        sb.append(config.cssExpandTreeIconLMinus);
        break;
      case 8:
        sb.append(config.cssExpandTreeIconT);
        break;
      case 9:
        sb.append(config.cssExpandTreeIconTPlus);
        break;
      case 10:
        sb.append(config.cssExpandTreeIconTMinus);
        break;
      default:  // 0
        sb.append(config.cssExpandTreeIconBlank);
    }
  } else {
    if (hideLines) {
      sb.append(config.cssExpandTreeIconBlank);
    } else if (this.isLastSibling()) {
      sb.append(config.cssExpandTreeIconL);
    } else {
      sb.append(config.cssExpandTreeIconT);
    }
  }
  return sb.toString();
};


/**
 * @return {!goog.html.SafeStyle} The line style.
 */
goog.ui.tree.BaseNode.prototype.getLineStyle = function() {
  'use strict';
  const nonEmptyAndExpanded = this.getExpanded() && this.hasChildren();
  return goog.html.SafeStyle.create({
    'background-position': this.getBackgroundPosition(),
    'display': nonEmptyAndExpanded ? null : 'none'
  });
};


/**
 * @return {string} The background position style value.
 */
goog.ui.tree.BaseNode.prototype.getBackgroundPosition = function() {
  'use strict';
  return (this.isLastSibling() ?
              '-100' :
              (this.getDepth() - 1) * this.config_.indentWidth) +
      'px 0';
};


/**
 * @return {Element} The element for the tree node.
 * @override
 */
goog.ui.tree.BaseNode.prototype.getElement = function() {
  'use strict';
  let el = goog.ui.tree.BaseNode.superClass_.getElement.call(this);
  if (!el) {
    el = this.getDomHelper().getElement(this.getId());
    this.setElementInternal(el);
  }
  return el;
};


/**
 * @return {Element} The row is the div that is used to draw the node without
 *     the children.
 */
goog.ui.tree.BaseNode.prototype.getRowElement = function() {
  'use strict';
  const el = this.getElement();
  return el ? /** @type {Element} */ (el.firstChild) : null;
};


/**
 * @return {Element} The expanded icon element.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getExpandIconElement = function() {
  'use strict';
  const el = this.getRowElement();
  return el ? /** @type {Element} */ (el.firstChild) : null;
};


/**
 * @return {Element} The icon element.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getIconElement = function() {
  'use strict';
  const el = this.getRowElement();
  return el ? /** @type {Element} */ (el.childNodes[1]) : null;
};


/**
 * @return {Element} The label element.
 */
goog.ui.tree.BaseNode.prototype.getLabelElement = function() {
  'use strict';
  const el = this.getRowElement();
  // TODO: find/fix race condition that requires us to add
  // the lastChild check
  return el && el.lastChild ?
      /** @type {Element} */ (el.lastChild.previousSibling) :
                             null;
};


/**
 * @return {Element} The element after the label.
 */
goog.ui.tree.BaseNode.prototype.getAfterLabelElement = function() {
  'use strict';
  const el = this.getRowElement();
  return el ? /** @type {Element} */ (el.lastChild) : null;
};


/**
 * @return {Element} The div containing the children.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.getChildrenElement = function() {
  'use strict';
  const el = this.getElement();
  return el ? /** @type {Element} */ (el.lastChild) : null;
};


/**
 * Sets the icon class for the node.
 * @param {string} s The icon class.
 */
goog.ui.tree.BaseNode.prototype.setIconClass = function(s) {
  'use strict';
  this.iconClass_ = s;
  if (this.isInDocument()) {
    this.updateIcon_();
  }
};


/**
 * Gets the icon class for the node.
 * @return {string} s The icon source.
 */
goog.ui.tree.BaseNode.prototype.getIconClass = function() {
  'use strict';
  return this.iconClass_;
};


/**
 * Sets the icon class for when the node is expanded.
 * @param {string} s The expanded icon class.
 */
goog.ui.tree.BaseNode.prototype.setExpandedIconClass = function(s) {
  'use strict';
  this.expandedIconClass_ = s;
  if (this.isInDocument()) {
    this.updateIcon_();
  }
};


/**
 * Gets the icon class for when the node is expanded.
 * @return {string} The class.
 */
goog.ui.tree.BaseNode.prototype.getExpandedIconClass = function() {
  'use strict';
  return this.expandedIconClass_;
};


/**
 * Sets the text of the label.
 * @param {string} s The plain text of the label.
 */
goog.ui.tree.BaseNode.prototype.setText = function(s) {
  'use strict';
  this.setSafeHtml(goog.html.SafeHtml.htmlEscape(s));
};


/**
 * Returns the text of the label. If the text was originally set as HTML, the
 * return value is unspecified.
 * @return {string} The plain text of the label.
 */
goog.ui.tree.BaseNode.prototype.getText = function() {
  'use strict';
  return goog.string.unescapeEntities(goog.html.SafeHtml.unwrap(this.html_));
};


/**
 * Sets the HTML of the label.
 * @param {!goog.html.SafeHtml} html The HTML object for the label.
 */
goog.ui.tree.BaseNode.prototype.setSafeHtml = function(html) {
  'use strict';
  this.html_ = html;
  const el = this.getLabelElement();
  if (el) {
    goog.dom.safe.setInnerHtml(el, html);
  }
  const tree = this.getTree();
  if (tree) {
    // Tell the tree control about the updated label text.
    tree.setNode(this);
  }
};


/**
 * Returns the html of the label.
 * @return {string} The html string of the label.
 * @final
 */
goog.ui.tree.BaseNode.prototype.getHtml = function() {
  'use strict';
  return goog.html.SafeHtml.unwrap(this.getSafeHtml());
};


/**
 * Returns the html of the label.
 * @return {!goog.html.SafeHtml} The html string of the label.
 */
goog.ui.tree.BaseNode.prototype.getSafeHtml = function() {
  'use strict';
  return this.html_;
};


/**
 * Sets the text of the tooltip.
 * @param {string} s The tooltip text to set.
 */
goog.ui.tree.BaseNode.prototype.setToolTip = function(s) {
  'use strict';
  this.toolTip_ = s;
  const el = this.getLabelElement();
  if (el) {
    el.title = s;
  }
};


/**
 * Returns the text of the tooltip.
 * @return {?string} The tooltip text.
 */
goog.ui.tree.BaseNode.prototype.getToolTip = function() {
  'use strict';
  return this.toolTip_;
};


/**
 * Updates the row styles.
 */
goog.ui.tree.BaseNode.prototype.updateRow = function() {
  'use strict';
  const rowEl = this.getRowElement();
  if (rowEl) {
    rowEl.className = this.getRowClassName();
  }
};


/**
 * Updates the expand icon of the node.
 */
goog.ui.tree.BaseNode.prototype.updateExpandIcon = function() {
  'use strict';
  const img = this.getExpandIconElement();
  if (img) {
    img.className = this.getExpandIconClass();
  }
  const cel = this.getChildrenElement();
  if (cel) {
    cel.style.backgroundPosition = this.getBackgroundPosition();
  }
};


/**
 * Updates the icon of the node. Assumes that this.getElement() is created.
 * @private
 */
goog.ui.tree.BaseNode.prototype.updateIcon_ = function() {
  'use strict';
  this.getIconElement().className = this.getCalculatedIconClass();
};


/**
 * Handles mouse down event.
 * @param {!goog.events.BrowserEvent} e The browser event.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.onMouseDown = function(e) {
  'use strict';
  const el = e.target;
  // expand icon
  const type = el.getAttribute('type');
  if (type == 'expand' && this.hasChildren()) {
    if (this.isUserCollapsible_) {
      this.toggle();
    }
    return;
  }

  this.select();
  this.updateRow();
};


/**
 * Handles a click event.
 * @param {!goog.events.BrowserEvent} e The browser event.
 * @protected
 * @suppress {underscore|visibility}
 */
goog.ui.tree.BaseNode.prototype.onClick_ = goog.events.Event.preventDefault;


/**
 * Handles a double click event.
 * @param {!goog.events.BrowserEvent} e The browser event.
 * @protected
 * @suppress {underscore|visibility}
 */
goog.ui.tree.BaseNode.prototype.onDoubleClick_ = function(e) {
  'use strict';
  const el = e.target;
  // expand icon
  const type = el.getAttribute('type');
  if (type == 'expand' && this.hasChildren()) {
    return;
  }

  if (this.isUserCollapsible_) {
    this.toggle();
  }
};


/**
 * Handles a key down event.
 * @param {!goog.events.BrowserEvent} e The browser event.
 * @return {boolean} The handled value.
 * @protected
 */
goog.ui.tree.BaseNode.prototype.onKeyDown = function(e) {
  'use strict';
  let handled = true;
  switch (e.keyCode) {
    case goog.events.KeyCodes.RIGHT:
      if (e.altKey) {
        break;
      }
      if (this.hasChildren()) {
        if (!this.getExpanded()) {
          this.setExpanded(true);
        } else {
          this.getFirstChild().select();
        }
      }
      break;

    case goog.events.KeyCodes.LEFT:
      if (e.altKey) {
        break;
      }
      if (this.hasChildren() && this.getExpanded() && this.isUserCollapsible_) {
        this.setExpanded(false);
      } else {
        const parent = this.getParent();
        const tree = this.getTree();
        // don't go to root if hidden
        if (parent && (tree.getShowRootNode() || parent != tree)) {
          parent.select();
        }
      }
      break;

    case goog.events.KeyCodes.DOWN:
      const nextNode = this.getNextShownNode();
      if (nextNode) {
        nextNode.select();
      }
      break;

    case goog.events.KeyCodes.UP:
      const previousNode = this.getPreviousShownNode();
      if (previousNode) {
        previousNode.select();
      }
      break;

    default:
      handled = false;
  }

  if (handled) {
    e.preventDefault();
    const tree = this.getTree();
    if (tree) {
      // clear type ahead buffer as user navigates with arrow keys
      tree.clearTypeAhead();
    }
  }

  return handled;
};



/**
 * @return {goog.ui.tree.BaseNode} The last shown descendant.
 */
goog.ui.tree.BaseNode.prototype.getLastShownDescendant = function() {
  'use strict';
  if (!this.getExpanded() || !this.hasChildren()) {
    return this;
  }
  // we know there is at least 1 child
  return this.getLastChild().getLastShownDescendant();
};


/**
 * @return {goog.ui.tree.BaseNode} The next node to show or null if there isn't
 *     a next node to show.
 */
goog.ui.tree.BaseNode.prototype.getNextShownNode = function() {
  'use strict';
  if (this.hasChildren() && this.getExpanded()) {
    return this.getFirstChild();
  } else {
    let parent = this;
    let next;
    while (parent != this.getTree()) {
      next = parent.getNextSibling();
      if (next != null) {
        return next;
      }
      parent = parent.getParent();
    }
    return null;
  }
};


/**
 * @return {goog.ui.tree.BaseNode} The previous node to show.
 */
goog.ui.tree.BaseNode.prototype.getPreviousShownNode = function() {
  'use strict';
  const ps = this.getPreviousSibling();
  if (ps != null) {
    return ps.getLastShownDescendant();
  }
  const parent = this.getParent();
  const tree = this.getTree();
  if (!tree.getShowRootNode() && parent == tree) {
    return null;
  }
  // The root is the first node.
  if (this == tree) {
    return null;
  }
  return /** @type {goog.ui.tree.BaseNode} */ (parent);
};


/**
 * @return {*} Data set by the client.
 * @deprecated Use {@link #getModel} instead.
 */
goog.ui.tree.BaseNode.prototype.getClientData =
    goog.ui.tree.BaseNode.prototype.getModel;


/**
 * Sets client data to associate with the node.
 * @param {*} data The client data to associate with the node.
 * @deprecated Use {@link #setModel} instead.
 */
goog.ui.tree.BaseNode.prototype.setClientData =
    goog.ui.tree.BaseNode.prototype.setModel;


/**
 * @return {Object} The configuration for the tree.
 */
goog.ui.tree.BaseNode.prototype.getConfig = function() {
  'use strict';
  return this.config_;
};


/**
 * Internal method that is used to set the tree control on the node.
 * @param {goog.ui.tree.TreeControl} tree The tree control.
 */
goog.ui.tree.BaseNode.prototype.setTreeInternal = function(tree) {
  'use strict';
  if (this.tree != tree) {
    this.tree = tree;
    // Add new node to the type ahead node map.
    tree.setNode(this);
    this.forEachChild(function(child) {
      'use strict';
      child.setTreeInternal(tree);
    });
  }
};


/**
 * A default configuration for the tree.
 */
goog.ui.tree.BaseNode.defaultConfig = {
  indentWidth: 19,
  cssRoot: goog.getCssName('goog-tree-root') + ' ' +
      goog.getCssName('goog-tree-item'),
  cssHideRoot: goog.getCssName('goog-tree-hide-root'),
  cssItem: goog.getCssName('goog-tree-item'),
  cssChildren: goog.getCssName('goog-tree-children'),
  cssChildrenNoLines: goog.getCssName('goog-tree-children-nolines'),
  cssTreeRow: goog.getCssName('goog-tree-row'),
  cssItemLabel: goog.getCssName('goog-tree-item-label'),
  cssTreeIcon: goog.getCssName('goog-tree-icon'),
  cssExpandTreeIcon: goog.getCssName('goog-tree-expand-icon'),
  cssExpandTreeIconPlus: goog.getCssName('goog-tree-expand-icon-plus'),
  cssExpandTreeIconMinus: goog.getCssName('goog-tree-expand-icon-minus'),
  cssExpandTreeIconTPlus: goog.getCssName('goog-tree-expand-icon-tplus'),
  cssExpandTreeIconTMinus: goog.getCssName('goog-tree-expand-icon-tminus'),
  cssExpandTreeIconLPlus: goog.getCssName('goog-tree-expand-icon-lplus'),
  cssExpandTreeIconLMinus: goog.getCssName('goog-tree-expand-icon-lminus'),
  cssExpandTreeIconT: goog.getCssName('goog-tree-expand-icon-t'),
  cssExpandTreeIconL: goog.getCssName('goog-tree-expand-icon-l'),
  cssExpandTreeIconBlank: goog.getCssName('goog-tree-expand-icon-blank'),
  cssExpandedFolderIcon: goog.getCssName('goog-tree-expanded-folder-icon'),
  cssCollapsedFolderIcon: goog.getCssName('goog-tree-collapsed-folder-icon'),
  cssFileIcon: goog.getCssName('goog-tree-file-icon'),
  cssExpandedRootIcon: goog.getCssName('goog-tree-expanded-folder-icon'),
  cssCollapsedRootIcon: goog.getCssName('goog-tree-collapsed-folder-icon'),
  cssSelectedRow: goog.getCssName('selected')
};