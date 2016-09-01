'use strict';

angular.module('pusher-angular', [])

.provider('pConnection', function() {
  var appKey;
  var config;

  /**
   * Pusher connection configuration.
   *
   * This sets application wide Pusher connection configuration before
   * application starts.
   *
   * Example:
   *
   *   angular.module('myApp').config(function (pConnectionProvider) {
   *     pConnectionProvider.configure(
   *       'f6169e7dc9bc0d5ab905',
   *       {
   *         cluster: 'eu',
   *         encrypted: true
   *       }
   *   )
   *
   */
  this.configure = function(_appKey_, _config_) {
    appKey = _appKey_;
    config = _config_;
  };

  this.$get = [
    '$window', '$timeout', '$log', 'pChannel',
    function($window, $timeout, $log, pChannel) {
      function pConnection() {
        this.client = new $window.Pusher(appKey, config);
        this.channels = {};
      }

      /**
       * Channel subscription
       *
       * Subscribes to a channel. Once the relevant scope is destroyed
       * it's callbacks will automatically leave the channel.
       *
       * @param {string} name
       * @param {Object} $scope
       * @returns {object} instance of pChannel
       */
      pConnection.prototype.subscribe = function subscribe(name, $scope) {
        var self = this;

        if (typeof this.channels[name] === 'undefined') {
          // Channel we're not yet subscribed to
          this.channels[name] = {
            channel: this.client.subscribe(name),
            scopes: [$scope]
          }
        } else {
          // Previous subscription already exist
          this.channels[name].scopes.push($scope);
        }

        $scope.$on('$destroy', function() {
          self.channels[name].scopes.splice(
            self.channels[name].scopes.indexOf($scope),
            1
          );

          if (self.channels[name].scopes.length === 0) {
            $log.debug('Leaving channel', name);
            delete self.channels[name];
            self.client.unsubscribe(name);
          }
        });

        return new pChannel(self.channels[name].channel, $scope);
      };

      // Not implemented: rest of Pusher connection API

      return new pConnection();
    }
  ];
})

.factory('pChannel', [
  '$log', '$timeout', 'pEvent',
  function($log, $timeout, pEvent) {
    var pChannel = function pChannel(channel, $scope) {
      this.$scope = $scope;
      this.channel = channel;
    };

    /**
     * @param {string} event
     * @param {Function} callback
     */
    pChannel.prototype.on = function on(event, callback) {
      var self = this;

      var wrappedCallback = function(data) {
        $log.debug('Invoking callback with:', data);
        var ev = new pEvent(self.channel, event, data);
        // Callback from "third party" component - need to use $timeout so
        // Angular starts scope digest / apply afterwards.
        $timeout(function() {
          callback(ev);
        }, 0);
      };

      this.channel.bind(event, wrappedCallback);

      this.$scope.$on('$destroy', function() {
        self.channel.unbind(event, wrappedCallback);
      });
    };

    /*
     Not implemented: Rest of channel API

     pChannel.prototype. ...
    */

    return pChannel;
  }
])

.factory('pEvent', [
  function() {
    /**
     * Event object to provide both actual event data and some context
     * to the listeners.
     *
     * Makes delegating handling of multiple events to single callback simpler.
     *
     * @param channel
     * @param name
     * @param data
       */
    var pEvent = function pEvent(channel, name, data) {
      this.channel = channel;
      this.name = name;
      this.data = data;
    };

    return pEvent;
  }
]);
