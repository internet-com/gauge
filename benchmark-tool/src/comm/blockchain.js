/**
* Original work Copyright 2017 HUAWEI. All Rights Reserved.
*
* Modified work Copyright Persistent Systems 2018. All Rights Reserved.
* 
* SPDX-License-Identifier: Apache-2.0
*
* @file, definition of the BlockChain class, which is used to interact with backend's blockchain system.
*/


'use strict'

var path = require('path');
var json2csv = require('json2csv');
var fs = require('fs');
const os = require('os');

var Blockchain = class {
    constructor(configPath) {
        var args = require(configPath).blockchain;
        this.bcType = args.type;
        this.bcObj = null;
        if (this.bcType === 'fabric') {
            var fabric = require('../fabric/fabric.js');
            this.bcObj = new fabric(path.join(path.dirname(configPath), args.config), configPath);
        } else if (this.bcType === 'quorum') {
            const quorum = require('../quorum/quorum.js')
            this.bcObj = new quorum(path.join(path.dirname(configPath), args.config));
        } else {
            throw new Error('Unknown blockchain type, ' + this.bcType);
        }
    }

    /**
    * return the blockchain type
    * @return {string}
    */
    gettype() {
        return this.bcType;
    }

    /**
    * prepare the underlying blockchain environment, e.g. join channel for fabric's peers
    * the function should be called only once for the same backend's blockchain system
    * even if multiple Blockchain objects are instantiated
    * @return {Promise}
    */
    init() {
        return this.bcObj.init();
    }

    /**
    * install smart contract on peers
    * the detailed smart contract's information should be defined in the configuration file
    * @return {Promise}
    */
    installSmartContract() {
        return this.bcObj.installSmartContract();
    }

    /**
    * get a system context that will be used to interact with backend's blockchain system
    * @name {string}, name of the context
    * @return {Promise.resolve(context)}
    */
    getContext(name) {
        return this.bcObj.getContext(name);
    }

    /**
   * get result confirmation that will be used to check if the transaction invoked are successfully committed or not
   * @result {string}, result after invoking all transaction
   * @return {Promise.resolve(context)}
   */
    getResultConfirmation(bcContext, result) {
        return this.bcObj.getResultConfirmation(bcContext, result);
    }

    /**
    * release the system context
    * @return {Promise}
    */
    releaseContext(context) {
        return this.bcObj.releaseContext(context);
    }

    /**
    * perform an 'invoke' transaction
    * @context {Object}, context returned by getContext
    * @contractID {string}, smart contract's id
    * @contractVer {string}, smart contract's version
    * @args {Array}, invoking arguments [arg1, arg2, ...]
    * @timeout {Number}, return directly after that time in seconds has elapsed
    * @return {Promise.resolve(Object)}, return the key informations of the transaction, the format is
     *       {
    *           'id': transaction's id
    *           'status':  status of the transaction, should be:
    *                        - 'created': successfully created, but not validated or committed yet
    *                        - 'success': successfully validated and committed in the ledger
    *           'time_create': time that the transaction was created
    *           'time_valid':  time that the transaction was known to be valid and committed in ledger
    *           'result': response payloads of the transaction request
    *           ...... :  blockchain platform specific values
    *         }
    */
    invokeSmartContract(context, contractID, contractVer, args, timeout, channelId) {

        if (typeof timeout !== 'number' || timeout < 0) {
            return this.bcObj.invokeSmartContract(context, contractID, contractVer, args, 120, channelId);
        }
        else {
            return this.bcObj.invokeSmartContract(context, contractID, contractVer, args, timeout, channelId);
        }
    }

    /**
    * * perform a 'query' transaction to get state from the ledger
    * @return {Promsie}, same format as invokeSmartContract's returning
    */
    queryState(context, contractID, contractVer, key, channelId) {

        return this.bcObj.queryState(context, contractID, contractVer, key, channelId);
    }

    /**
    * txStatistics = {
    *     succ : ,                            // number of succeeded txs
    *     fail : ,                            // number of failed txs
    *     create : {min: , max: },            // min/max time of tx created
    *     valid  : {min: , max: },            // min/max time of tx becoming valid
    *     delay  : {min: , max: , sum: },     // min/max/sum time of txs' processing delay
    *     throughput : {time: ,...},          // tps of each time slot
    *     others: {object}                    // blockchain platform specific values
    * }
    */
    /**
    * generate and return the default statistics of transactions
    * @ results {Array}, results of 'invoke'/'query' transactions
    * @ return {Promise.resolve(txStatistics)}
    */
    // TODO: should be moved to a dependent 'analyser' module in which to do all result analysing work
    getDefaultTxStats(results) {
        var fields = ['transaction_id', 'send_time', 'valid_time', 'c2e', 'e2o', 'o2v', 'delay']
        var c2e, e2o, o2v;
        var result = []
        var succ = 0, fail = 0, delay = 0;
        var minValid, maxValid, minCreate, maxCreate;
        var minDelay = 100000, maxDelay = 0;
        var throughput = {};
        for (let i = 0; i < results.length; i++) {

            let stat = results[i];
            let create = stat['time_create'];

            if (typeof minCreate === 'undefined') {
                minCreate = create;
                maxCreate = create;
            }
            else {
                if (create < minCreate) {
                    minCreate = create;
                }
                if (create > maxCreate) {
                    maxCreate = create;
                }
            }



            if (stat.status === 'success') {
                succ++;
                let valid = stat['time_valid'];
                let d = valid - create;
                c2e = stat['time_endorse'] - stat['time_create']
                e2o = stat['time_order'] - stat['time_endorse']
                o2v = stat['time_valid'] - stat['time_order']
                var obj = {
                    'transaction_id': stat['id'],
                    'send_time': create,
                    'valid_time': valid,
                    'c2e': c2e,
                    'e2o': e2o,
                    'o2v': o2v,
                    'delay': d
                }
                result.push(obj);
                if (typeof minValid === 'undefined') {
                    minValid = valid;
                    maxValid = valid;
                }
                else {
                    if (valid < minValid) {
                        minValid = valid;
                    }
                    if (valid > maxValid) {
                        maxValid = valid;
                    }
                }

                delay += d;
                if (d < minDelay) {
                    minDelay = d;
                }
                if (d > maxDelay) {
                    maxDelay = d;
                }

                let idx = Math.round(valid).toString();
                if (typeof throughput[idx] === 'undefined') {
                    throughput[idx] = 1;
                }
                else {
                    throughput[idx] += 1;
                }
            }
            else {
                fail++;
            }
        }

        var output = '\n\n' + json2csv({ data: result, fields: fields }) + '\n\n';
        fs.appendFileSync(os.hostname() + '_transactions_summary.csv', output);

        var stats = {
            'succ': succ,
            'fail': fail,
            'create': { 'min': minCreate, 'max': maxCreate },
            'valid': { 'min': minValid, 'max': maxValid },
            'delay': { 'min': minDelay, 'max': maxDelay, 'sum': delay },
            'throughput': throughput
        };

        if (this.bcObj.getDefaultTxStats !== 'undefined') {
            this.bcObj.getDefaultTxStats(stats, results);
        }

        return stats;
    }
}

module.exports = Blockchain;