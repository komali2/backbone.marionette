// ViewMixin
//  ---------

import Backbone                 from 'backbone';
import _                        from 'underscore';
import Behaviors                from './behaviors';
import _getValue                from './utils/_getValue';
import getOption                from './utils/getOption';
import normalizeMethods         from './utils/normalizeMethods';
import normalizeUIKeys          from './utils/normalizeUIKeys';
import normalizeUIValues        from './utils/normalizeUIValues';
import mergeOptions             from './utils/mergeOptions';
import proxyGetOption           from './utils/proxyGetOption';
import MarionetteError          from './error';
import Renderer                 from './renderer';
import View                     from './view';
import { proxyBindEntityEvents, proxyUnbindEntityEvents } from './bind-entity-events';
import { _triggerMethod }       from './trigger-method';

export default {
  supportsRenderLifecycle: true,
  supportsDestroyLifecycle: true,

  _isDestroyed: false,

  isDestroyed: function() {
    return !!this._isDestroyed;
  },

  _isRendered: false,

  isRendered: function() {
    return !!this._isRendered;
  },

  _initBehaviors: function() {
    var behaviors = _getValue(this.getOption('behaviors'), this);
    this._behaviors = Behaviors(this, behaviors);
  },

  // Get the template for this view
  // instance. You can set a `template` attribute in the view
  // definition or pass a `template: "whatever"` parameter in
  // to the constructor options.
  getTemplate: function() {
    return this.getOption('template');
  },

  // Internal method to render the template with the serialized data
  // and template context via the `Marionette.Renderer` object.
  _renderTemplate: function() {
    var template = this.getTemplate();

    // Allow template-less views
    if (template === false) {
      return;
    }

    // Add in entity data and template context
    var data = this.mixinTemplateContext(this.serializeData());

    // Render and add to el
    var html = Renderer.render(template, data, this);
    this.attachElContent(html);
  },

  // Prepares the special `model` property of a view
  // for being displayed in the template. By default
  // we simply clone the attributes. Override this if
  // you need a custom transformation for your view's model
  serializeModel: function() {
    if (!this.model) { return {}; }
    return _.clone(this.model.attributes);
  },

  // Mix in template context methods. Looks for a
  // `templateContext` attribute, which can either be an
  // object literal, or a function that returns an object
  // literal. All methods and attributes from this object
  // are copies to the object passed in.
  mixinTemplateContext: function(target) {
    target = target || {};
    var templateContext = this.getOption('templateContext');
    templateContext = _getValue(templateContext, this);
    return _.extend(target, templateContext);
  },

  // normalize the keys of passed hash with the views `ui` selectors.
  // `{"@ui.foo": "bar"}`
  normalizeUIKeys: function(hash) {
    var uiBindings = _.result(this, '_uiBindings');
    return normalizeUIKeys(hash, uiBindings || _.result(this, 'ui'));
  },

  // normalize the values of passed hash with the views `ui` selectors.
  // `{foo: "@ui.bar"}`
  normalizeUIValues: function(hash, properties) {
    var ui = _.result(this, 'ui');
    var uiBindings = _.result(this, '_uiBindings');
    return normalizeUIValues(hash, uiBindings || ui, properties);
  },

  // Configure `triggers` to forward DOM events to view
  // events. `triggers: {"click .foo": "do:foo"}`
  configureTriggers: function() {
    if (!this.triggers) { return; }

    // Allow `triggers` to be configured as a function
    var triggers = this.normalizeUIKeys(_.result(this, 'triggers'));

    // Configure the triggers, prevent default
    // action and stop propagation of DOM events
    return _.reduce(triggers, function(events, value, key) {
      events[key] = this._buildViewTrigger(value);
      return events;
    }, {}, this);
  },

  // Overriding Backbone.View's `delegateEvents` to handle
  // `events` and `triggers`
  delegateEvents: function(eventsArg) {
    // proxy behavior $el to the view's $el.
    _.invoke(this._behaviors, 'proxyViewProperties', this);

    var events = _getValue(eventsArg || this.events, this);

    // normalize ui keys
    events = this.normalizeUIKeys(events);
    if (typeof eventsArg === 'undefined') {this.events = events;}

    var combinedEvents = {};

    // look up if this view has behavior events
    var behaviorEvents = _.result(this, 'behaviorEvents') || {};
    var triggers = this.configureTriggers();
    var behaviorTriggers = _.result(this, 'behaviorTriggers') || {};

    // behavior events will be overriden by view events and or triggers
    _.extend(combinedEvents, behaviorEvents, events, triggers, behaviorTriggers);

    Backbone.View.prototype.delegateEvents.call(this, combinedEvents);

    return this;
  },

  // Handle `modelEvents`, and `collectionEvents` configuration
  delegateEntityEvents: function() {
    this.undelegateEntityEvents();

    this.bindEntityEvents(this.model, this.getOption('modelEvents'));
    this.bindEntityEvents(this.collection, this.getOption('collectionEvents'));

    _.each(this._behaviors, function(behavior) {
      behavior.bindEntityEvents(this.model, behavior.getOption('modelEvents'));
      behavior.bindEntityEvents(this.collection, behavior.getOption('collectionEvents'));
    }, this);

    return this;
  },

  // Handle unbinding `modelEvents`, and `collectionEvents` configuration
  undelegateEntityEvents: function() {
    this.unbindEntityEvents(this.model, this.getOption('modelEvents'));
    this.unbindEntityEvents(this.collection, this.getOption('collectionEvents'));

    _.each(this._behaviors, function(behavior) {
      behavior.unbindEntityEvents(this.model, behavior.getOption('modelEvents'));
      behavior.unbindEntityEvents(this.collection, behavior.getOption('collectionEvents'));
    }, this);

    return this;
  },

  // Internal helper method to verify whether the view hasn't been destroyed
  _ensureViewIsIntact: function() {
    if (this._isDestroyed) {
      throw new MarionetteError({
        name: 'ViewDestroyedError',
        message: 'View (cid: "' + this.cid + '") has already been destroyed and cannot be used.'
      });
    }
  },

  // Handle destroying the view and its children.
  destroy: function() {
    if (this._isDestroyed) { return this; }

    var args = _.toArray(arguments);

    this.triggerMethod.apply(this, ['before:destroy'].concat(args));

    // update lifecycle flags
    this._isDestroyed = true;
    this._isRendered = false;

    // unbind UI elements
    this.unbindUIElements();

    // remove the view from the DOM
    // https://github.com/jashkenas/backbone/blob/1.2.3/backbone.js#L1235
    this._removeElement();

    // remove children after the remove to prevent extra paints
    this._removeChildren();
    // Call destroy on each behavior after
    // destroying the view.
    // This unbinds event listeners
    // that behaviors have registered for.
    _.invoke(this._behaviors, 'destroy', args);

    this.triggerMethod.apply(this, ['destroy'].concat(args));

    this.stopListening();

    return this;
  },

  bindUIElements: function() {
    this._bindUIElements();
    _.invoke(this._behaviors, this._bindUIElements);
  },

  // This method binds the elements specified in the "ui" hash inside the view's code with
  // the associated jQuery selectors.
  _bindUIElements: function() {
    if (!this.ui) { return; }

    // store the ui hash in _uiBindings so they can be reset later
    // and so re-rendering the view will be able to find the bindings
    if (!this._uiBindings) {
      this._uiBindings = this.ui;
    }

    // get the bindings result, as a function or otherwise
    var bindings = _.result(this, '_uiBindings');

    // empty the ui so we don't have anything to start with
    this._ui = {};

    // bind each of the selectors
    _.each(bindings, function(selector, key) {
      this._ui[key] = this.$(selector);
    }, this);

    this.ui = this._ui;
  },

  // This method unbinds the elements specified in the "ui" hash
  unbindUIElements: function() {
    this._unbindUIElements();
    _.invoke(this._behaviors, this._unbindUIElements);
  },

  _unbindUIElements: function() {
    if (!this.ui || !this._uiBindings) { return; }

    // delete all of the existing ui bindings
    _.each(this.ui, function($el, name) {
      delete this.ui[name];
    }, this);

    // reset the ui element to the original bindings configuration
    this.ui = this._uiBindings;
    delete this._uiBindings;
    delete this._ui;
  },

  getUI: function(name) {
    this._ensureViewIsIntact();

    return this._ui[name];
  },

  // Internal method to create an event handler for a given `triggerDef` like
  // 'click:foo'
  _buildViewTrigger: function(triggerDef) {
    var options = _.defaults({}, triggerDef, {
      preventDefault: true,
      stopPropagation: true
    });

    var eventName = _.isObject(triggerDef) ? options.event : triggerDef;

    return function(e) {
      if (e) {
        if (e.preventDefault && options.preventDefault) {
          e.preventDefault();
        }

        if (e.stopPropagation && options.stopPropagation) {
          e.stopPropagation();
        }
      }

      var args = {
        view: this,
        model: this.model,
        collection: this.collection
      };

      this.triggerMethod(eventName, args);
    };
  },

  // used as the prefix for child view events
  // that are forwarded through the layoutview
  childViewEventPrefix: 'childview',

  // import the `triggerMethod` to trigger events with corresponding
  // methods if the method exists
  triggerMethod: function() {
    var ret = _triggerMethod(this, arguments);

    this._triggerEventOnBehaviors(arguments);
    this._triggerEventOnParentLayout(arguments[0], _.rest(arguments));

    return ret;
  },

  _triggerEventOnBehaviors: function(args) {
    var triggerMethod = _triggerMethod;
    var behaviors = this._behaviors;
    // Use good ol' for as this is a very hot function
    for (var i = 0, length = behaviors && behaviors.length; i < length; i++) {
      triggerMethod(behaviors[i], args);
    }
  },

  _triggerEventOnParentLayout: function(eventName, args) {
    var layoutView = this._parentItemView();
    if (!layoutView) {
      return;
    }

    // invoke triggerMethod on parent view
    var eventPrefix = getOption(layoutView, 'childViewEventPrefix');
    var prefixedEventName = eventPrefix + ':' + eventName;
    var callArgs = [this].concat(args);

    _triggerMethod(layoutView, [prefixedEventName].concat(callArgs));

    // call the parent view's childEvents handler
    var childEvents = getOption(layoutView, 'childEvents');

    // since childEvents can be an object or a function use Marionette._getValue
    // to handle the abstaction for us.
    childEvents = _getValue(childEvents, layoutView);
    var normalizedChildEvents = layoutView.normalizeMethods(childEvents);

    if (!!normalizedChildEvents && _.isFunction(normalizedChildEvents[eventName])) {
      normalizedChildEvents[eventName].apply(layoutView, callArgs);
    }
  },

  // Returns an array of every nested view within this view
  _getNestedViews: function() {
    var children = this._getImmediateChildren();

    if (!children.length) { return children; }

    return _.reduce(children, function(memo, view) {
      if (!view._getNestedViews) { return memo; }
      return memo.concat(view._getNestedViews());
    }, children);
  },

  // Walk the _parent tree until we find a view (if one exists).
  // Returns the parent view hierarchically closest to this view.
  _parentItemView: function() {
    var parent  = this._parent;

    while (parent) {
      if (parent instanceof View) {
        return parent;
      }
      parent = parent._parent;
    }
  },

  // Imports the "normalizeMethods" to transform hashes of
  // events=>function references/names to a hash of events=>function references
  normalizeMethods: normalizeMethods,

  // A handy way to merge passed-in options onto the instance
  mergeOptions: mergeOptions,

  // Proxy `getOption` to enable getting options from this or this.options by name.
  getOption: proxyGetOption,

  // Proxy `bindEntityEvents` to enable binding view's events from another entity.
  bindEntityEvents: proxyBindEntityEvents,

  // Proxy `unbindEntityEvents` to enable unbinding view's events from another entity.
  unbindEntityEvents: proxyUnbindEntityEvents
};
