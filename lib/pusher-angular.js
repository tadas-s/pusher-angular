'use strict';

angular.module('pusher-angular', [])

.provider('pConnection', function() {
  var appKey;
  var config;

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
  '$log', '$timeout',
  function($log, $timeout) {
    var pChannel = function pChannel(channel, $scope) {
      this.$scope = $scope;
      this.channel = channel;
    };

    pChannel.prototype.on = function on(event, callback) {
      var self = this;

      var wrappedCallback = function(data) {
        $log.debug('Invoking callback with:', data);
        // Callback from "third party" component - need to use $timeout so
        // Angular starts scope digest / apply afterwards.
        $timeout(function() {
          callback(data);
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
]);
