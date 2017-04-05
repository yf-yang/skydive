const helpers = require("./helpers"),
  DefinePlugin = require('webpack/lib/DefinePlugin'),
  ProvidePlugin = require('webpack/lib/ProvidePlugin'),
  CopyWebpackPlugin = require('copy-webpack-plugin');

let config = {
  entry: {
    "app": helpers.root("/src/app.ts")
  },
  output: {
    path: helpers.root("/statics/js"),
    filename: "[name].js"
  },
  devtool: "source-map",
  resolve: {
    extensions: [".ts", ".js", ".html"],
    alias: {
      'vue$': 'vue/dist/vue.esm.js',
      'vuex$': 'vuex/dist/vuex.esm.js',
      'vue-router$': 'vue-router/dist/vue-router.esm.js',
      'jquery-ui$': 'jquery-ui-dist/jquery-ui.min.js'
    }
  },
  module: {
    rules: [
      {test: /\.ts$/, exclude: /node_modules/, enforce: 'pre', loader: 'tslint-loader'},
      {test: /\.ts$/, exclude: /node_modules/, loader: "awesome-typescript-loader"},
      {test: /\.html$/, loader: 'raw-loader', exclude: ['./src/index.html']}
    ],
  },
  plugins: [
    new CopyWebpackPlugin([
      {from: 'src/img', to: '../img'},
      {from: 'node_modules/bootstrap/dist/fonts/glyphicons-halflings-regular.woff2', to: '../fonts/glyphicons-halflings-regular.woff2'},
      {from:'node_modules/font-awesome/fonts/fontawesome-webfont.woff2', to:'../fonts/fontawesome-webfont.woff2'},
      {from: 'src/css', to: '../css'},
      {from: 'node_modules/bootstrap/dist/css/bootstrap.min.css', to: '../css/bootstrap.min.css'},
      {from: 'node_modules/bootstrap/dist/css/bootstrap.min.css.map', to: '../css/bootstrap.min.css.map'},
      {from:'node_modules/font-awesome/css/font-awesome.min.css', to:'../css/font-awesome.min.css'},
      {from:'node_modules/jquery-ui-dist/jquery-ui.min.css', to:'../css/jquery-ui.min.css'}
    ]),
    new DefinePlugin({
      'process.env': {
        'ENV': process.env.NODE_ENV,
        'NODE_ENV': process.env.NODE_ENV
      }
    }),
    new ProvidePlugin({   
        jQuery: 'jquery',
        $: 'jquery',
        jquery: 'jquery'
    })
  ]
};

module.exports = config;
