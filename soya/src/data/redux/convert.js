import React from 'react';
import update from 'react-addons-update';

import { isEqualShallow } from './helper.js';

/**
 * Wraps a react component inside a component that subcribes to queries to the
 * ReduxStore. The wrapping component encapsulates how, when, what and where
 * to fetch the context. The relationship between a subscriber component and
 * ReduxStore is as follows:
 *
 * 1) Wrapper tells ReduxStore the Segment it needs via getSegmentDependencies().
 * 2) Subscriber component may manually query pieces of Segment it has
 *    registered using each Segment's action creator - it gets action creator
 *    from props provided by wrapper component.
 * 3) Subscriber component may subscribe to a query by implementing
 *    subscribeQueries() static method. This will make wrapper sets query result
 *    as props to the subscriber component. Each change in query result will
 *    trigger re-render of the wrapper (via state), and thus setting of new
 *    props to the subscriber component.
 *
 * Subscriber components props and state relationship:
 *
 * 1) Props are given by owner component to the wrapper component.
 * 2) Wrapper component subscribes to queries and update these subscriptions
 *    based on props provided by owner component.
 * 3) Props in wrapper component determines query in wrapper component.
 * 4) Query subscription determines wrapper component's React state.
 * 5) Wrapper component state determines props to subscriber component.
 *
 * @CLIENT_SERVER
 */

/**
 * This method is called at componentWilMount(). Wrapper will register
 * the returned Segment constructors to ReduxStore. Child components must
 * override this static method to specify their data requirements.
 *
 * @return {Array<Class<Segment>>}
 */
var defaultGetSegmentDependencies = function() {
  return [];
};

/**
 * Semantics are very similar to shouldComponentUpdate(). This method
 * determines whether to re-run subscribeQueries() or not when this component
 * will receive new props.
 *
 * Props is the prime determinator of query subscription in DataComponent.
 *
 * Default implementation uses shallowEqual. User can override as needed.
 *
 * @param {Object} prevProps
 * @param {Object} nextProps
 *
 * @CLIENT_SERVER
 */
var defaultShouldSubcriptionsUpdate = function(prevProps, nextProps) {
  var shouldUpdateSubscription = !isEqualShallow(prevProps, nextProps);
  console.log('[SUB] Should update subscriptions', shouldUpdateSubscription);
  return shouldUpdateSubscription;
};

/**
 * Subscribes to queries to a Segment already registered at
 * getSegmentDependencies().
 *
 * @param {Object} nextProps
 * @param {Function} subscribe
 */
var defaultSubscribeQueries = function(nextProps, subscribe) {

};

/**
 * @param {React.Component} ReactComponent
 * @return {React.Component}
 */
export default function convert(ReactComponent) {
  var getSegmentDependencies = ReactComponent.getSegmentDependencies;
  var subscribeQueries = ReactComponent.subscribeQueries;
  var shouldSubscriptionsUpdate = ReactComponent.shouldSubscriptionUpdate;
  var shouldWrapperComponentUpdate = ReactComponent.shouldWrapperComponentUpdate;
  if (typeof shouldSubscriptionsUpdate !== 'function') shouldSubscriptionsUpdate = defaultShouldSubcriptionsUpdate;
  if (typeof subscribeQueries !== 'function') subscribeQueries = defaultSubscribeQueries;
  if (typeof getSegmentDependencies !== 'function') getSegmentDependencies = defaultGetSegmentDependencies;

  return class Component extends React.Component {
    /**
     * @type {{[key: string]: Object}}
     */
    __soyaActions;

    /**
     * @type {Function}
     */
    __soyaSubscribe;

    /**
     * @type {{[key: string]: Function}}
     */
    __soyaUnsubscribe;

    /**
     * @type {Function}
     */
    __soyaGetActionCreator;

    /**
     * @type {ReduxStore}
     */
    __soyaGetReduxStore;

    /**
     * @type {Object}
     */
    __soyaGetConfig;

    static getSegmentDependencies() {
      return getSegmentDependencies();
    }

    constructor(props, context) {
      super(props, context);

      // Both actions and unsubscribe is not part of state because it shouldn't
      // affect rendering in any way. Actions are determined at mounting and
      // shouldn't change throughout this component's lifecycle. Unsubscribe
      // contains functions that unsubscribes this component from state changes,
      // but it's the actual state that matters.
      this.__soyaActions = {};
      this.__soyaUnsubscribe = {};
      this.__soyaGetActionCreator = this.getActionCreator.bind(this);
      this.__soyaSubscribe = this.subscribe.bind(this);
      this.__soyaGetReduxStore = this.getReduxStore.bind(this);
      this.__soyaGetConfig = this.getConfig.bind(this);

      var reduxStore = this.getReduxStore();
      var config = this.getConfig();
      if (!reduxStore || !reduxStore.__isReduxStore) {
        throw new Error('ReduxStore is not properly wired to this data component: ' + this.constructor + '.');
      }
      if (!config || typeof config != 'object') {
        throw new Error('Config object is not properly wired to this data component: ' + this.constructor + '.');
      }
    }

    /**
     * Defaults to getting ReduxStore instance from props.store. If you want to
     * use context you can override this method.
     *
     * @returns {ReduxStore}
     */
    getReduxStore() {
      return this.props.reduxStore;
    }

    /**
     * Defaults to getting Config object from props.config. If you want to use
     * context you can override this method.
     *
     * @returns {Object}
     */
    getConfig() {
      return this.props.config;
    }

    /**
     * @param {string} segmentId
     * @param {any} query
     * @param {string} stateName
     * @param {?Object} hydrationOption
     */
    subscribe(segmentId, query, stateName, hydrationOption) {
      // Unsubscribe if already subscribed.
      this.unsubscribe(stateName);

      console.log('[SUB] Subscribe', this, segmentId);
      var callback = (newState) => {
        this.setState({[stateName]: newState});
      };

      var storeRef = this.getReduxStore().subscribe(
        segmentId, query, callback, this, hydrationOption);
      this.unsubscribe[segmentId] = storeRef.unsubscribe;
      this.setState({
        [stateName]: storeRef.getState()
      });
    }

    /**
     * @param {string} stateName
     */
    unsubscribe(stateName) {
      if (this.__soyaUnsubscribe[stateName]) {
        console.log('[SUB] Un-subscribe', this, stateName);
        this.__soyaUnsubscribe[stateName]();
        delete this.__soyaUnsubscribe[stateName];
      }
    }

    /**
     * Returns action creator of an already registered segment.
     *
     * @param {string} segmentId
     * @return {Object}
     */
    getActionCreator(segmentId) {
      if (!this.__soyaActions.hasOwnProperty(segmentId)) {
        throw new Error('Unable to get action creator for segment \'' + segmentId + '\', segment is not registered.');
      }
      return this.__soyaActions[segmentId];
    }

    render() {
      if (!this.__soyaGetActionCreator) this.__soyaGetActionCreator = this.getActionCreator.bind(this);
      var props = update(this.props, { getActionCreator: {$set: this.__soyaGetActionCreator}});
      props.result = this.state;
      props.getReduxStore = this.__soyaGetReduxStore;
      props.getConfig = this.__soyaGetConfig;
      return <ReactComponent {...props} />;
    }

    /**
     * @param {Class<Segment>} segmentClass
     */
    _register(segmentClass) {
      var actionCreator = this.getReduxStore().register(segmentClass);
      this.__soyaActions[segmentClass.id()] = actionCreator;
    }

    /**
     * This implementation assumes:
     *
     * 1) All subscriber components render only using props and states (i.e. they
     *    are pure render components). Child classes can override this method
     *    if they are not.
     * 2) All wrapper component owner send their props as immutable objects
     *    (i.e. if the prop changes, they recreate the whole object).
     *
     * Based on the above assumptions, this method will do a shallow comparison
     * of both state and props. Child component can stop re-rendering by
     * creating their own shouldComponentUpdate method.
     *
     * @param {Object} nextProps
     * @param {Object} nextState
     * @return {boolean}
     */
    shouldComponentUpdate(nextProps, nextState) {
      if (shouldWrapperComponentUpdate) return shouldWrapperComponentUpdate(this.props, nextProps, this.state, nextState);
      var shouldUpdate = !isEqualShallow(this.props, nextProps) || !isEqualShallow(this.state, nextState);
      console.log('[SUB] Should update?', this, shouldUpdate);
      return shouldUpdate;
    }

    componentWillUpdate(nextProps, nextState) {
      console.log('[SUB] Will update', this, nextProps, nextState);
    }

    /**
     * @param {Object} nextProps
     */
    componentWillReceiveProps(nextProps) {
      // TODO: Logger at client! Remove if debug is set to false!
      if (shouldSubscriptionsUpdate(this.props, nextProps)) {
        // If query subscriptions update, we need to remove past subscriptions.
        // Otherwise this component may unnecessarily re-render each time the
        // already unrelated segment piece changes. Since this is costly, this
        // is why shouldSubscriptionsUpdate() is important.
        this.getReduxStore().unsubscribe(this);
        subscribeQueries(nextProps, this.__soyaSubscribe);
      }
    }

    /**
     * Registers the store. Run at both client and server side when rendering.
     */
    componentWillMount() {
      console.log('[SUB] Mounting', this, this.props);
      var i, segmentClasses = getSegmentDependencies();
      for (i = 0; i < segmentClasses.length; i++) {
        this._register(segmentClasses[i]);
      }
      subscribeQueries(this.props, this.__soyaSubscribe);
    }

    /**
     * Unsubscribe all segments.
     */
    componentWillUnmount() {
      console.log('[SUB] Unmounting', this);
      this.getReduxStore().unsubscribe(this);
    }
  }
}