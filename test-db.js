const { MongoClient } = require('mongodb'); 
async function run() { 
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cat_exam_db'); 
  await client.connect(); 
  const db = client.db(); 
  const user = await db.collection('users').findOne({mobile: '8777652995'}); 
  console.log(user); 
  await client.close(); 
} 
run();
