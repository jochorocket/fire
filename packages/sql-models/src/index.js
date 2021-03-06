/* eslint-disable import/no-dynamic-require */
import path from 'path';
import * as babel from 'babel-core';
import babelPresetEnv from 'babel-preset-env';
import fs from 'fs';
import Simulator from 'sql-simulator';
import createSql from 'sql-creator';

import { zeroPad, createDirectory, getMigrationFileNames, getCurrentVersion, writeMigration, createMigrationContents } from './migrations.js';
import { getDatabaseVersion, createMigrationsTable, insertMigration } from './release.js';

const modelClasses = [];

export default function model(Model) {
    modelClasses.push(Model);
}

export async function runMigrations() {
    const databaseVersion = await getDatabaseVersion();
    const currentVersion = await getCurrentVersion();

    if (databaseVersion > currentVersion) {
        // Error!
    }
    else if (databaseVersion < currentVersion) {
        // Migrate!
        await createMigrationsTable();

        console.log(`Migrate from ${databaseVersion} to ${currentVersion}`);

        const migrationsBuildPath = path.join(process.cwd(), `.build`, `migrations`);

        await transaction(async (trans) => {
            for (let version = databaseVersion + 1; version <= currentVersion; version++) {
                const migration = require(path.join(migrationsBuildPath, `${zeroPad(version, 100)}.js`));

                await migration.up(trans);
            }
        });

        await insertMigration(currentVersion);
    }
    else {
        // Nothing on the hand! :)
    }
}

export async function createMigrations() {
    // First, babelify the migrations from ./migrations to ./.build/migrations/**.
    const filePaths = await getMigrationFileNames();
    const migrationsBuildPath = path.join(process.cwd(), `.build`, `migrations`);

    await createDirectory(migrationsBuildPath);

    filePaths.forEach((filePath) => {
        const transform = babel.transformFileSync(filePath, {
            presets: [babelPresetEnv],
        });

        fs.writeFileSync(path.join(migrationsBuildPath, path.basename(filePath)), transform.code);
    });

    const fromSimulator = new Simulator();
    const toSimulator   = new Simulator();

    // Load the migrations from process.cwd().
    filePaths.forEach((filePath) => {
        const migration = require(path.join(migrationsBuildPath, path.basename(filePath)));

        const transaction = {
            sql(strings) {
                fromSimulator.simulateQuery(strings[0]);
            }
        };
        migration.up(transaction);
    });

    // Load the models.
    require(path.join(process.cwd(), `.build`, `server.js`));

    modelClasses.forEach((Model) => {
        const transaction = {
            sql(strings) {
                toSimulator.simulateQuery(strings[0]);
            }
        }
        new Model(transaction);
    });

    const fromSimulatorDown = new Simulator(fromSimulator);
    const toSimulatorDown = new Simulator(toSimulator);

    const upQueries = createSql(fromSimulator, toSimulator);

    if (upQueries.length > 0) {
        const downQueries = createSql(toSimulatorDown, fromSimulatorDown);
        const currentVersion = await getCurrentVersion();

        const contents = createMigrationContents(upQueries, downQueries);

        await writeMigration(currentVersion + 1, contents);
    }
}
