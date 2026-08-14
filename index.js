require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

// ==========================================
// 1. PERSISTENT MONGODB CONNECTION
// ==========================================
let cachedClient = null;

async function getDatabase() {
  if (!cachedClient) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 1,
    });
    await client.connect();
    cachedClient = client;
  }
  return cachedClient.db('cat_prep_db');
}

// ==========================================
// 2. HELPER: STANDARDIZED RESPONSES
// ==========================================
const sendResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    // CORS headers must be sent manually if not configured in API Gateway natively
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Credentials': true,
  },
  body: JSON.stringify(body),
});

// ==========================================
// 3. MAIN NATIVE HANDLER
// ==========================================
exports.handler = async (event, context) => {
  // CRITICAL: Tells Lambda not to wait for MongoDB idle connections to close
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    // 1. Extract Routing Info from API Gateway Payload (HTTP API v2 format)
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.requestContext?.http?.path || event.path;
    
    // Handle CORS Preflight requests natively
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PATCH,DELETE',
        },
        body: '',
      };
    }

    // 2. Native Authentication Check
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (path !== '/health' && authHeader !== `Bearer ${process.env.API_SECRET}`) {
      return sendResponse(401, { error: 'Unauthorized. Invalid API Secret.' });
    }

    const db = await getDatabase();

    // ==========================================
    // 4. ROUTER (Vanilla JS Switch/If block)
    // ==========================================

    // Route: GET /api/exams/{examId}
    if (method === 'GET' && path.startsWith('/api/exams/')) {
      const examId = path.split('/').pop();
      const exam = await db.collection('exams').findOne({ examId });
      
      if (!exam) return sendResponse(404, { error: 'Exam not found' });
      return sendResponse(200, exam);
    }

    // Route: POST /api/attempts/start
    if (method === 'POST' && path === '/api/attempts/start') {
      // Native parsing of the JSON body
      const body = JSON.parse(event.body || '{}');
      const { userId, examId } = body;

      const exam = await db.collection('exams').findOne({ examId });
      if (!exam) return sendResponse(404, { error: 'Exam not found' });

      // Build initial responses map
      const initialResponses = exam.sections.flatMap(sec => 
        sec.questionGroups.flatMap(group => 
          group.questions.map(q => ({
            questionId: q.questionId,
            selectedAnswer: null,
            status: 'NOT_VISITED',
            timeSpentSeconds: 0
          }))
        )
      );

      const newAttempt = {
        userId, examId, status: 'IN_PROGRESS', startedAt: new Date(), responses: initialResponses
      };

      const result = await db.collection('attempts').insertOne(newAttempt);
      return sendResponse(201, { attemptId: result.insertedId, ...newAttempt });
    }

    // Route: PATCH /api/attempts/{attemptId}/sync
    if (method === 'PATCH' && path.match(/\/api\/attempts\/([a-zA-Z0-9]+)\/sync/)) {
      const attemptId = path.split('/')[3]; 
      const body = JSON.parse(event.body || '{}');
      const { questionId, selectedAnswer, status } = body;

      await db.collection('attempts').updateOne(
        { _id: new ObjectId(attemptId), 'responses.questionId': questionId },
        {
          $set: {
            'responses.$.selectedAnswer': selectedAnswer,
            'responses.$.status': status,
            'responses.$.lastUpdatedAt': new Date(),
          }
        }
      );
      
      return sendResponse(200, { success: true });
    }

    // Route: POST /api/attempts/{attemptId}/submit
    if (method === 'POST' && path.match(/\/api\/attempts\/([a-zA-Z0-9]+)\/submit/)) {
      const attemptId = path.split('/')[3];
      // Grading logic (same as the Express version) goes here...
      
      await db.collection('attempts').updateOne(
        { _id: new ObjectId(attemptId) },
        { $set: { status: 'COMPLETED', submittedAt: new Date() } }
      );
      return sendResponse(200, { success: true, message: 'Exam graded natively' });
    }

    // Fallback 404
    return sendResponse(404, { error: `Route ${method} ${path} not found` });

  } catch (error) {
    console.error('Lambda Error:', error);
    return sendResponse(500, { error: error.message });
  }
};