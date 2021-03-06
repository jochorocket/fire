import path from 'path';

import nodeExternals from 'webpack-node-externals';
import babelPluginTransformStripClasses from 'babel-plugin-transform-strip-classes';
import babelPluginTransformDecoratorsLegacy from 'babel-plugin-transform-decorators-legacy';
import babelPluginTransformRuntime from 'babel-plugin-transform-runtime';

import babelPresetFlow from 'babel-preset-flow';
import babelPresetReact from 'babel-preset-react';
import babelPresetEnv from 'babel-preset-env';
import babelPresetStage3 from 'babel-preset-stage-3';
import babelPresetStage2 from 'babel-preset-stage-2';
import { cloneDeep } from 'lodash';
import webpack from 'webpack';
import doWebpack from './webpack.js';

const initialConfig = {
    entry: {},
    module: {
        loaders: [],
    },
    target: null,
    output: null,
    plugins: [],
    resolve: {},
};

function addResolveAlias(shims) {
    return (config) => {
        const shimPath = path.join(__dirname, `shim.js`);

        config.resolve.alias = shims.reduce((alias, currentShim) => {
            alias[currentShim] = shimPath;
            return alias;
        }, {});

        return config;
    };
}

function addClientConfig(entry) {
    return (config) => {
        config.target = `web`;
        config.stats = `none`;
        config.entry = {
            client: [
                `babel-polyfill`,
                `webpack-hot-middleware/client`,
                `isomorphic-fetch`,
                entry,
                `fire/lib/client/index.js`,
            ],
        };
        config.output = {
            publicPath: `/`,
            path: `/`,
            filename: `[name].js`,
        };
        config.plugins = [
            new webpack.DefinePlugin({
                // NODE_ENV: JSON.stringify(`production`),
            }),
            new webpack.HotModuleReplacementPlugin(),
            new webpack.NoEmitOnErrorsPlugin(),
        ];

        // TODO: source-map exposes the server functions. If NODE_ENV=development only set source-map?
        config.devtool = `source-map`;
        config.node = {
            console: false,
            global: true,
            process: true,
            __filename: `mock`,
            __dirname: `mock`,
            Buffer: true,
            setImmediate: true,
            fs: `empty`,
            tls: `empty`,
            child_process: `empty`,
            net: `empty`,
            crypto: `empty`,
            path: `empty`,
        };
        config.resolveLoader = {
            modules: [
                path.join(__dirname, `..`, `node_modules`),
                path.join(process.cwd(), `node_modules`),
                `node_modules`,
            ],
        };
        config.resolve = {
            modules: [
                path.join(__dirname, `..`, `node_modules`),
                path.join(process.cwd(), `node_modules`),
                `node_modules`,
            ],
        };
        return config;
    };
}

function addServerConfig(entry) {
    return (config) => {
        config.target = `node`;
        config.entry = {
            server: [
                `babel-polyfill`,
                `isomorphic-fetch`,
                entry,
            ],
        };
        config.output = {
            publicPath: `/`,
            path: path.join(process.cwd(), `.build`),
            filename: `[name].js`,
        },
        config.externals = [nodeExternals()];
        config.plugins = [
            new webpack.NoEmitOnErrorsPlugin(),
            new webpack.DefinePlugin({
                NODE_ENV: process.env.NODE_ENV,
            }),
        ];
        config.resolveLoader = {
            modules: [
                path.join(__dirname, `..`, `node_modules`),
                path.join(process.cwd(), `node_modules`),
                `node_modules`,
            ],
        };
        config.resolve = {
            modules: [
                path.join(__dirname, `..`, `node_modules`),
                path.join(process.cwd(), `node_modules`),
                `node_modules`,
            ],
        };
        return config;
    };
}

function addBabelStripClassesPlugin(serviceNames) {
    return (config) => {
        const loader = config.module.loaders.find((loader) => loader.loader === `babel-loader`);

        if (loader) {
            loader.options.plugins.splice(0, 0, [babelPluginTransformStripClasses, {
                classes: serviceNames,
            }]);
        }

        return config;
    }
}

function addBabelLoader(babelPresetEnvOptions = {}) {
    return (config) => {
        config.module.loaders.push({
            test: /.js$/,
            exclude: /node_modules/,
            loader: `babel-loader`,
            options: {
                presets: [
                    babelPresetFlow,
                    babelPresetReact,
                    [babelPresetEnv, babelPresetEnvOptions],
                    babelPresetStage3,
                    babelPresetStage2,
                ],
                plugins: [
                    babelPluginTransformDecoratorsLegacy,
                    babelPluginTransformRuntime,
                ],
            },
        });
        return config;
    };
}

const clientReducers = [];
const serverReducers = [];

const shimsInClient = [
    `fsevents`,
    `koa`,
    `webpack`,
    `koa-webpack`,
    `dns`,
    `lego-sql`,
    `babel-core`,
    `babel-preset-env`,
];
const shimsInServer = [];

export function addShims(type, moduleNames) {
    if (type === `client`) {
        shimsInClient.splice(0, 0, ...moduleNames);
    }
    else if (type === `server`) {
        shimsInServer.splice(0, 0, ...moduleNames);
    }
    else {
        throw new Error(`Invalid type`);
    }
}

export function configureWebpack(type, reducer) {
    if (type === `client`) {
        clientReducers.push(reducer);
    }
    else if (type === `server`) {
        serverReducers.push(reducer);
    }
    else {
        throw new Error(`Unknown type "${type}". Type should be one of client or server.`);
    }
}

function createWebpackConfig(reducers) {
    return reducers.reduce((config, reducer) => {
        const nextConfig = reducer(config);
        return nextConfig;
    }, cloneDeep(initialConfig));
}

export function createServerBundle(entry) {
    const allReducers = [
        addServerConfig(entry),
        addBabelLoader(),
        addResolveAlias(shimsInServer),
        ...serverReducers,
    ];
    const webpackConfig = createWebpackConfig(allReducers);

    console.log(`createServerBundle`);
    console.log(webpackConfig);

    return doWebpack(webpackConfig);
}

export function createClientCompiler(entry, serviceNames) {
    const allReducers = [
        addClientConfig(entry),
        addBabelLoader({
            exclude: [
                // `transform-es2015-classes`,
            ],
        }),
        addBabelStripClassesPlugin(serviceNames),
        addResolveAlias(shimsInClient),
        ...clientReducers,
    ];
    const webpackConfig = createWebpackConfig(allReducers);

    console.log(`createClientCompiler`);
    console.log(JSON.stringify(webpackConfig, null, 2));

    return webpack(webpackConfig);
}
