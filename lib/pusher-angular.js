'use strict';

angular.module('pusher-angular', [])

.provider('$pusher', function() {
  var appKey;
  var config;

  this.configure = function(_appKey_, _config_) {
    appKey = _appKey_;
    config = _config_;
  };

  this.$get = [
    '$window', '$rootScope', '$channel', '$connection', '$timeout', '$log',
    function($window, $rootScope, $channel, $connection, $timeout, $log) {
      function PusherAngular() {
        this.client = new $window.Pusher(appKey, config);
        this.channels = {};
      }

      PusherAngular.prototype = {
        on: function(channel, event, $scope, callback) {
          var self = this;

          // Allow omitting $scope argument if used by a service
          if (typeof $scope === 'function' && typeof callback === 'undefined') {
            callback = $scope;
            $scope = undefined;
          }

          // join channel
          if (typeof this.channels[channel] === 'undefined') {
            this.channels[channel] = {
              channel: this.client.subscribe(channel),
              events: {}
            };
          }

          if (typeof this.channels[channel].events[event] === 'undefined') {
            this.channels[channel].events[event] = {
              listeners: []
            }
          }

          var handler = function(data) {
            $log.debug('Invoking callback with:', data);
            // Callback from "third party" component - need to use $timeout so
            // Angular starts scope digest / apply afterwards.
            $timeout(function() {
              callback(data);
            }, 0);
          };

          this.channels[channel].channel.bind(event, handler);
          this.channels[channel].events[event].listeners.push(handler);

          // Given scope is provided, register a destroy callback to de-register
          // event callbacks + possibly leave subscribed channels.
          if ($scope) {
            $scope.$on('$destroy', function() {
              $log.debug('Unbinding handler', channel, '/', event);
              self.channels[channel].channel.unbind(event, handler);

              self.channels[channel].events[event].listeners.splice(
                self.channels[channel].events[event].listeners.indexOf(handler), 1
              );

              if (self.channels[channel].events[event].listeners.length === 0) {
                delete self.channels[channel].events[event];
              }

              var numEvents = 0;

              for (var name in self.channels[channel].events) {
                if(self.channels[channel].events[name].listeners.length > 0) {
                  numEvents++;
                }
              }

              if (numEvents === 0) {
                // no more listeners left, leave the channel
                $log.debug('Leaving channel ', channel);
                self.client.unsubscribe(channel);
                delete self.channels[channel];
              }
            });
          }
        }
      };

      return new PusherAngular();
    }
  ];
})

.factory('$channel', ['$rootScope', '$members',
  function ($rootScope, $members) {

    function checkPresenceOrPrivateChannel (channelName) {
      if (channelName.indexOf('presence-') == -1 && channelName.indexOf('private-') == -1) {
        throw new Error('Presence or private channel required');
      }
    }

    function $channel (baseChannel, $pusherClient) {
      if (!(this instanceof $channel)) {
        return new $channel(baseChannel, $pusherClient);
      }

      this._assertValidChannel(baseChannel);
      this.baseChannel = baseChannel;
      this.client = $pusherClient;
      this.name = baseChannel.name;

      if (baseChannel.name.indexOf('presence') == -1) {
        this.members = function () { throw new Error('Members object only exists for presence channels'); }
      } else {
        this.members = $members(baseChannel.members, baseChannel);
      }
    }

    $channel.prototype = {
      /**
       * Binds to the given event name on the channel.
       *
       * @param {String} eventName name of the event you want to bind to
       * @param {Function|undefined} callback callback that you want called upon the event occurring
       * @param {Object} context used as the `this` value when calling a handler
       * @param {boolean} [invokeDigest=true] If set to `false` skips invoking $digest
       * @returns {Function} the decorated version of the callback provided
       */
      bind: function (eventName, callback, context, invokeDigest) {
        var skipDigest = (angular.isDefined(invokeDigest) && !invokeDigest),
            decoratedCallback = function (data) {
              callback(data);
              if (!skipDigest) $rootScope.$digest();
            };
        this.baseChannel.bind(eventName, decoratedCallback, context);
        return decoratedCallback;
      },

      /**
       * Unbinds from the given event name on the channel.
       *
       * @param {String} eventName name of the event you want to bind from
       * @param {Function|undefined} decoratedCallback the decorated version of the callback that you want to unbind
       * @param {Object} context used as the `this` value when calling a handler
       */
      unbind: function (eventName, decoratedCallback, context) {
        this.baseChannel.unbind(eventName, decoratedCallback, context);
      },

      /**
       * Binds to all of the channel events.
       *
       * @param {Function|undefined} callback callback that you want called upon the event occurring
       * @param {boolean} [invokeDigest=true] If set to `false` skips invoking $digest
       */
      bind_all: function (callback, invokeDigest) {
        var skipDigest = (angular.isDefined(invokeDigest) && !invokeDigest);
        this.baseChannel.bind_all(function (eventName, data) {
          callback(eventName, data);
          if (!skipDigest) $rootScope.$digest();
        });
      },

      /**
       * Triggers a client event.
       * {@link https://pusher.com/docs/client_api_guide/client_events#trigger-events}
       *
       * @param {String} channelName name of the channel
       * @param {String} eventName name of the event
       * @param {Object} obj object that you wish to pass along with your client event
       * @returns {}
       */
      trigger: function (eventName, obj) {
        checkPresenceOrPrivateChannel(this.name);
        if (eventName.indexOf('client-') == -1) { throw new Error('Event name requires \'client-\' prefix'); }
        return this.baseChannel.trigger(eventName, obj);
      },

      /**
       * Asserts that the $channel object is being initialised with valid baseChannel.
       * Throws an error if baseChannel is invalid.
       *
       * @param {Object} baseChannel channel object from base pusher channel object
       */
      _assertValidChannel: function (baseChannel) {
        if (!angular.isObject(baseChannel) ||
            typeof(baseChannel.name) !== 'string') {
          throw new Error('Invalid Pusher channel object');
        }
      }
    };

    return $channel;
  }
])

.factory('$members', ['$rootScope',
  function ($rootScope) {

    function $members (baseMembers, baseChannel) {
      if (!(this instanceof $members)) {
        return new $members(baseMembers, baseChannel);
      }
      var self = this;

      this._assertValidMembers(baseMembers);
      this.baseMembers = baseMembers;
      this.baseChannel = baseChannel;
      this.me = {};
      this.count = 0;
      this.members = {};

      baseChannel.bind('pusher:subscription_succeeded', function (members) {
        self.me = members.me;
        self.count = members.count;
        self.members = members.members;
        $rootScope.$digest();
      });

      baseChannel.bind('pusher:member_added', function (member) {
        self.count++;
        if (member.info) {
          self.members[member.id.toString()] = member.info;
        } else {
          self.members[member.id.toString()] = null;
        }
        $rootScope.$digest();
      });

      baseChannel.bind('pusher:member_removed', function (member) {
        self.count--;
        delete self.members[member.id.toString()];
        $rootScope.$digest();
      });
    }

    $members.prototype = {
     /**
      * Returns member's info for given id. Resulting object containts two fields - id and info.
      *
      * @param {Number} id user's id
      * @return {Object} member's info or null
      */
      get: function (id) {
        return this.baseMembers.get(id);
      },

      /**
       * Calls back for each member in unspecified order.
       *
       * @param {Function} callback callback function
       */
      each: function (callback) {
        this.baseMembers.each(function (member) {
          callback(member);
          $rootScope.$digest();
        });
      },

      /**
       * Asserts that the $members object is being initialised with valid baseMembers.
       * Throws an error if baseMembers is invalid.
       *
       * @param {Object} baseMembers members object from base pusher channel object
       */
      _assertValidMembers: function (baseMembers) {
        if (!angular.isObject(baseMembers) ||
            typeof(baseMembers.me) !== 'object') {
          throw new Error('Invalid Pusher channel members object');
        }
      }
    };

    return $members;
  }
])

.factory('$connection', ['$rootScope',
  function ($rootScope) {

    function $connection (baseConnection, baseClient) {
      if (!(this instanceof $connection)) {
        return new $connection(baseConnection, baseClient);
      }

      this._assertValidConnection(baseConnection);
      this.baseConnection = baseConnection;
      this.baseClient = baseClient;
    }

    $connection.prototype = {
      /**
       * Binds to the given event name on the connection.
       *
       * @param {String} eventName name of the event you want to bind to
       * @param {Function|undefined} callback callback that you want called upon the event occurring
       * @param {Object} context used as the `this` value when calling a handler
       * @param {boolean} [invokeDigest=true] If set to `false` skips invoking $digest
       */
      bind: function (eventName, callback, context, invokeDigest) {
        var skipDigest = (angular.isDefined(invokeDigest) && !invokeDigest);
        this.baseConnection.bind(eventName, function (data) {
          callback(data);
          if (!skipDigest) $rootScope.$digest();
        }, context);
      },

      /**
       * Binds to all of the global connection events.
       *
       * @param {Function|undefined} callback callback that you want called upon the event occurring
       * @param {boolean} [invokeDigest=true] If set to `false` skips invoking $digest
       */
      bind_all: function (callback, invokeDigest) {
        var skipDigest = (angular.isDefined(invokeDigest) && !invokeDigest);
        this.baseConnection.bind_all(function (eventName, data) {
          callback(eventName, data);
          if (!skipDigest) $rootScope.$digest();
        });
      },

      /**
       * Asserts that the $connection object is being initialised with valid baseConnection.
       * Throws an error if baseConnection is invalid.
       *
       * @param {Object} baseConnection connection object from base pusher object
       */
      _assertValidConnection: function (baseConnection) {
        if (!angular.isObject(baseConnection)) {
          throw new Error('Invalid Pusher connection object');
        }
      }
    };

    return $connection;
  }
]);
