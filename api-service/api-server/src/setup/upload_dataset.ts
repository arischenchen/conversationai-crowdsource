/*
Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/*
Usage:
  node build/server/setup/upload_dataset.js \
    --file="./src/testdata/conversations_job2_x5.json" \
    --question_group="conversations_job2_x5"
  node build/server/setup/upload_dataset.js \
    --file="./src/testdata/wp_goodish_x1000.json" \
    --question_group="wp_x2000"
  node build/server/setup/upload_dataset.js \
    --file="./src/testdata/wp_badish_x1000.json" \
    --question_group="wp_x2000"
  node build/server/setup/upload_dataset.js \
    --file="./tmp/real_job/toanswer_mini_x10.json" \
    --question_group="wp_x10k_test"

  ts-node src/setup/upload_dataset.ts \
    --file="tmp/foo.json" \
    --question_group="erica-demo-requests"
*/

import * as spanner from '@google-cloud/spanner';
import * as fs from 'fs';
import * as yargs from 'yargs';

import * as crowdsourcedb from '../cs_db';
import * as db_types from '../db_types';

import {batchList} from './util'

    interface Params {file: string, question_type: string, question_group: string, gcloud_project_id: string, spanner_instance: string, spanner_db: string, update_only: boolean,};

// type DataShape = wpconvlib.Conversation;
interface DataShape {
  id: string, text: string,
}
;

async function main(args: Params) {
  console.log(args.file);
  if (!fs.existsSync(args.file)) {
    console.error('--file argument does not exist: ' + args.file);
    return;
  }
  if (!db_types.valid_question_type_regexp.test(args.question_type)) {
    console.error(
        '--question_type must be a valid question type (training|test|toanswer), not: ' +
        args.question_type);
    return;
  }
  if (!db_types.valid_id_regexp.test(args.question_group)) {
    console.error(
        '--question_type must be a valid question type (training|test|toanswer), not: ' +
        args.question_type);
    return;
  }

  let spannerClient = spanner({projectId: args.gcloud_project_id});
  let spannerInstance = spannerClient.instance(args.spanner_instance);
  let spannerDatabase =
      spannerInstance.database(args.spanner_db, {keepAlive: 5});
  let db = new crowdsourcedb.CrowdsourceDB(spannerDatabase);

  let fileAsString = fs.readFileSync(args.file, 'utf8');
  let data: DataShape[] = JSON.parse(fileAsString);
  let questions: db_types.QuestionRow[] = [];
  for (let i = 0; i < data.length; i++) {
    let question: db_types.Question = data[i] as any;
    // let structured_conv = wpconvlib.structureConversaton(data[i]);
    // if(!structured_conv) {
    //   console.error('bad conversaion with no root: ' + question);
    //   break;
    // }
    // let id = structured_conv.id + ':' + i;
    let id = data[i].id;

    questions.push({
      accepted_answers: null,
      question: question,
      question_group_id: args.question_group,
      question_id: id,
      // TODO(ldixon): make nice typescript interence helper function.
      type: args.question_type as any,
    });
  }

  console.log(`conversations to add: ${data.length}`);
  console.log(`questions to add: ${questions.length}`);
  console.log(`(skipped bad conversations: ${data.length - questions.length})`);

  let batchedQuestions = batchList(10, questions);

  let total_added = 0;
  for (let batch of batchedQuestions) {
    if (args.update_only) {
      await db.updateQuestions(batch);
    } else {
      await db.addQuestions(batch);
    }
    total_added += batch.length;
    console.log(`uploaded questions: ${batch.length}`);
    console.log(`total of uploaded questions is now: ${total_added}`);
  }
}

let args =
    yargs
        .option(
            'file',
            {alias: 'f', describe: 'Path to JSON file of questions to upload'})
        .option('question_type', {
          alias: 't',
          describe: 'Question type, one of: training | test | toanswer'
        })
        .option('question_group', {
          alias: 'g',
          describe: 'Question type, one of: training | test | toanswer'
        })
        .option(
            'gcloud_project_id',
            {alias: 'gcp', describe: 'Google Cloud Project Id'})
        .option(
            'spanner_instance', {alias: 'i', describe: 'Spanner instance name'})
        .option('spanner_db', {alias: 's', describe: 'Spanner database name'})
        .option('update_only', {
          alias: 'u',
          describe:
              'If true, then do an update instead of an insert of the questons.'
        })
        .default('update_only', false)
        .default('gcloud_project_id', 'wikidetox')
        .default('spanner_instance', 'crowdsource')
        .default('spanner_db', 'testdb')
        .default('question_type', 'toanswer')
        .demandOption(
            ['file', 'question_group'],
            'Please provide at least --file and --question_group.')
        .help()
        .argv;

main(args as any as Params)
    .then(() => {
      console.log('Success!');
    })
    .catch(e => {
      console.error('Failed: ', e);
    });
