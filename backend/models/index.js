/**
 * models/index.js — Re-exports all Mongoose models
 */

const User = require('./User');
const Staff = require('./Staff');
const FileMeta = require('./FileMeta');
const Auth = require('./Auth');

module.exports = { User, Staff, FileMeta, Auth };
