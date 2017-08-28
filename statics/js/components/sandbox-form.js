/*
 * Copyright (C) 2017 Orange.
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */

function sortedKeys(obj) {
  var l = [];
  for (var t in obj) {
    l.push(+t);
  }
  return l.sort();
}

function whereToInsert(o, l, s, e) {
  var d = e - s;
  var p = s + d / 2;
  if (d <= 1 || l[p] === o)
    return p;
  if (l[p] < o) {
    return whereToInsert(o, l, p, e);
  }
  else {
    return whereToInsert(o, l, s, p);
  }
}

Vue.component('sandbox-form', {
  template: '\
    <form @submit.prevent="add">\
        <div class="form-group">\
            <label>Sandbox</label>\
            <select v-model="sandboxTime">\
                <option :value="0">No Sandbox</option>\
                <option v-for="v in sandboxList" :value="v">{{ sandboxes[v].text }}</option>\
            </select>\
        </div>\
        <div class="bottom-margin">\
          <button type="button"\
            class="btn btn-primary"\
            @click="addSandbox">Add Sandbox</button>\
          <button type="button"\
            class="btn btn-danger"\
            @click="removeSandbox">Remove Sandbox</button>\
        </div>\
        <div class="form-group">\
            <label>Target</label>\
            <node-selector class="inject-target"\
                placeholder="Host or bridge"\
                v-model="node"></node-selector>\
        </div>\
        <div class="bottom-margin">\
          <button type="submit"\
            class="btn btn-primary">Add Node(s)</button>\
          <button type="button"\
            class="btn btn-danger"\
            @click="remove">Remove Node(s)</button>\
        </div>\
        <div class="form-group">\
            <label>Packet</label>\
            <input class="form-control input-sm"\
                type="text"\
                placeholder="placeholder"\
                v-model="spec" />\
        </div>\
        <button type="button"\
            class="btn btn-primary"\
            @click="trace">Trace</button>\
        <div v-for="elt in path">\
            <h2>{{elt.Bridge.Metadata.Name}}</h2>\
            <table class="table table-bordered table-condensed rules-detail">\
                <thead>\
                    <tr>\
                        <th>table </th>\
                        <th>filters</th>\
                        <th>actions</th>\
                    </tr>\
                </thead>\
                <tbody>\
                  <template v-for="elt2 in elt.Path">\
                    <template v-if="elt2.Rule">\
                      <tr :id="\'RR-\' + elt2.Rule.Metadata.UUID"\
                        v-on:click="show(elt.Bridge, elt2.Rule)"\
                        v-bind:class="{ \'rule-selected\': isHighlighted(elt2.Rule) }">\
                        <td>{{elt2.Rule.Metadata.table}}</td>\
                        <td>{{elt2.Rule.Metadata.filters}}</td>\
                        <td>{{elt2.Rule.Metadata.actions}}</td>\
                      </tr>\
                    </template>\
                    <template v-else>\
                      <tr>\
                        <td></td>\
                        <td>No match.</td>\
                        <td>{{elt2.Event}}</td>\
                      </tr>\
                    </template>\
                  </template>\
                </tbody>\
            </table>\
        </div>\
    </form>\
    ',
  props: {
    graph: {
      type: Object,
      required: true
    }
  },
  mixins: [apiMixin, notificationMixin],

  data: function () {
    return {
      node: '',
      spec: '',
      path: [],
      sandboxTime: 0,
      sandboxes: {},
      sandboxList: []
    };
  },

  created: function () {
    if (this.$store.state.currentNode) {
      this.node = this.$store.state.currentNode.ID;
    }
  },

  beforeDestroy: function () {
    if (this.node) {
      this.highlightNode(this.node, false);
    }
    this.unwatch();
  },

  mounted: function () {
    websocket.addMsgHandler('Sandbox', this.processSandboxMessage.bind(this));
    var msg = { Namespace: 'Sandbox', Type: 'SandboxSyncRequest', Obj: {} };
    websocket.send(msg);
    var self = this;
    this.unwatch = this.$store.watch(
      function () {
        return self.$store.state.currentRule;
      },
      function (newNode, oldNode) {
        if (oldNode) {
          $('#RR-' + oldNode.metadata.UUID).removeClass('rule-selected');
        }
        if (newNode) {
          $('#RR-' + newNode.metadata.UUID).addClass('rule-selected');
        }
      }
    );
  },

  watch: {
    node: function (newVal, oldVal) {
      if (oldVal) {
        this.highlightNode(oldVal, false);
      }
      this.highlightNode(newVal, true);
    },

    sandboxTime: function (newVal, oldVal) {
      if (newVal !== 0) {
        this.$store.commit('time', newVal);
        // We want a copy to view the changes.
        this.$store.commit('sandbox', Object.assign({}, this.sandboxes[newVal]));
      } else {
        this.$store.commit('time', 0);
        this.$store.commit('sandbox', null);
      }
    }
  },

  computed: {
    error: function () {
      if (!this.node) {
        return 'Target node must be selected';
      } else {
        return null;
      }
    }
  },

  methods: {
    highlightNode: function (id, bool) {
      if (bool)
        this.$store.commit('highlight', id);
      else
        this.$store.commit('unhighlight', id);
    },

    isHighlighted: function (rule) {
      if (!rule) return false;
      var current = this.$store.state.currentRule;
      var status = current && rule.ID === current.ID;
      return status;
    },

    ajax: function (url, arg, success, failure, callback) {
      var self = this;
      $.ajax({
        dataType: 'json',
        url: url,
        data: JSON.stringify(arg),
        contentType: 'application/json; charset=utf-8',
        method: 'POST',
      }).then(function (data) {
        if (callback) {
          callback(data);
        }
        self.$success({ message: success });
      }).fail(function (e) {
        self.$error({ message: failure + ': ' + e.responseText });
      });
    },

    add: function () {
      var self = this;
      this.ajax(
        '/api/sandbox/register',
        { time: this.sandboxTime, TID: this.node },
        'Addition to sandbox successful',
        'Addition to sandbox failed');
    },

    remove: function () {
      var self = this;
      this.ajax(
        '/api/sandbox/unregister',
        { time: this.sandboxTime, TID: this.node },
        'Removal from sandbox successful',
        'Removal from sandbox failed');
    },

    addSandbox: function () {
      var time = this.$store.state.time;
      if (time != 0) {
        this.ajax(
          '/api/sandbox/add',
          { time: time },
          'Adding a sandbox successful',
          'Adding a sandbox failed');
      } else {
        this.$error({ message: "Sandbox requires a past date." });
      }
    },

    removeSandbox: function () {
      this.ajax(
        '/api/sandbox/remove',
        { time: this.sandboxTime },
        'Removing a sandbox successful',
        'Removing a sandbox failed');
    },

    trace: function () {
      var self = this;
      this.ajax(
        '/api/sandbox/trace',
        {
           time: this.sandboxTime,
           TID: this.node,
           Packet: this.spec,
        },
        'Packet trace successful',
        'Packet trace failed',
        function (d) { self.path = d.Path; });
    },

    show: function (bridge, rule) {
      if (!rule) return;
      bridge = this.graph.getNode(bridge.ID);
      rule = this.graph.getNode(rule.ID);
      this.$store.commit('selected', bridge);
      this.$store.commit('selectedRule', rule);
    },

    processSandboxMessage: function (msg) {
      var time, arg, sandbox;
      switch (msg.Type) {
        case 'SandboxAdded':
          time = msg.Obj;
          if (this.sandboxes[time]) break;
          this.sandboxes[time] = {
            time: time,
            text: new Date(time).toLocaleTimeString(),
            content: []
          };
          this.sandboxList.splice(
            whereToInsert(time, this.sandboxList, 0, this.sandboxList.length) + 1, 0, time);
          break;
        case 'SandboxSyncReply':
          var list = msg.Obj;
          for (var i = 0; i < list.length; i++) {
            var elt = list[i];
            time = elt.Time;
            this.sandboxes[time] = {
              time: time,
              text: new Date(time).toLocaleTimeString(),
              content: elt.Nodes
            };
          }
          this.sandboxList = sortedKeys(this.sandboxes);
          break;
        case 'SandboxDeleted':
          time = msg.Obj;
          delete this.sandboxes[time];
          var idx = this.sandboxList.indexOf(time);
          if (idx > -1) { this.sandboxList.splice(idx, 1); }
          if (this.sandboxTime == time) {
            this.$store.commit('time', 0);
            this.$store.commit('sandbox', null);
          }
          break;
        case 'SandboxNodesAdded':
          arg = msg.Obj;
          sandbox = this.sandboxes[arg.Time];
          if (sandbox) {
            sandbox.content = sandbox.content.concat(arg.Nodes);
          }
          if (arg.Time == this.sandboxTime) {
            this.$store.commit('sandbox', Object.assign({}, sandbox));
          }
          break;
        case 'SandboxNodesDeleted':
          arg = msg.Obj;this.$store.commit('sandbox', Object.assign({}, this.sandboxes[newVal]));
          sandbox = this.sandboxes[arg.Time];
          if (sandbox) {
            sandbox.content =
              sandbox.content.filter(
                function (n) { return arg.Nodes.indexOf(n) === -1; });
            if (arg.Time == this.sandboxTime) {
              this.$store.commit('sandbox', Object.assign({}, sandbox));
            }
          }
          break;
      }
    }
  }
});