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
    if (path !== '/health' && path !== '/api/auth/login' && authHeader !== `Bearer ${process.env.API_SECRET}`) {
      return sendResponse(401, { error: 'Unauthorized. Invalid API Secret.' });
    }

    const db = await getDatabase();

    // ==========================================
    // 4. ROUTER (Vanilla JS Switch/If block)
    // ==========================================

    // Route: POST /api/auth/login
    if (method === 'POST' && path === '/api/auth/login') {
      const body = JSON.parse(event.body || '{}');
      const { mobile, password } = body;

      const userDoc = await db.collection('users').findOne({ mobile, password });

      if (userDoc) {
        // Set isAdmin dynamically based on role so frontend logic works seamlessly
        userDoc.isAdmin = userDoc.role === 'admin';
        return sendResponse(200, { success: true, user: userDoc });
      } else {
        return sendResponse(401, { error: 'Invalid mobile number or password' });
      }
    }

    // Route: GET /api/admin/users
    if (method === 'GET' && path === '/api/admin/users') {
      const users = await db.collection('users').find({ role: { $ne: 'admin' } }).toArray();
      return sendResponse(200, users);
    }

    // Route: POST /api/admin/users/:mobile/retake
    if (method === 'POST' && path.match(/\/api\/admin\/users\/([a-zA-Z0-9]+)\/retake/)) {
      const targetMobile = path.split('/')[4];
      const body = JSON.parse(event.body || '{}');
      const { examId } = body;
      
      if (!examId) {
        return sendResponse(400, { error: 'examId is required' });
      }

      await db.collection('users').updateOne(
        { mobile: targetMobile },
        { $addToSet: { allowedRetakes: examId } }
      );
      return sendResponse(200, { success: true });
    }

    // Route: POST /api/admin/users (Create a basic user)
    if (method === 'POST' && path === '/api/admin/users') {
      const body = JSON.parse(event.body || '{}');
      const { name, mobile, password } = body;
      
      if (!name || !mobile || !password) {
        return sendResponse(400, { error: 'Name, mobile, and password are required' });
      }

      const existingUser = await db.collection('users').findOne({ mobile });
      if (existingUser) {
        return sendResponse(409, { error: 'User with this mobile number already exists' });
      }

      const newUser = {
        name,
        mobile,
        password,
        role: 'basic_user',
        allowedRetakes: [],
        createdAt: new Date().toISOString()
      };

      await db.collection('users').insertOne(newUser);
      return sendResponse(201, { success: true, user: newUser });
    }

    // Route: POST /api/admin/exams (Create a new exam via JSON upload)
    if (method === 'POST' && path === '/api/admin/exams') {
      const body = JSON.parse(event.body || '{}');
      const { exam } = body;
      
      if (!exam || !exam.examId) {
        return sendResponse(400, { error: 'Invalid exam structure or missing examId' });
      }

      const existingExam = await db.collection('exams').findOne({ examId: exam.examId });
      if (existingExam) {
        return sendResponse(409, { error: 'An exam with this examId already exists' });
      }

      await db.collection('exams').insertOne(exam);
      return sendResponse(201, { success: true, examId: exam.examId });
    }

    // Route: GET /api/attempts/user/:mobile
    if (method === 'GET' && path.match(/\/api\/attempts\/user\/([a-zA-Z0-9]+)/)) {
      const mobile = path.split('/')[4];
      const attempts = await db.collection('attempts')
        .find({ userId: mobile })
        .sort({ startedAt: -1 })
        .toArray();
      return sendResponse(200, attempts);
    }

    // Route: GET /api/exams (List all exams, sorted by newest)
    if (method === 'GET' && path === '/api/exams') {
      const exams = await db.collection('exams')
        .find({})
        .sort({ _id: -1 })
        .project({ examId: 1, title: 1, sections: 1 })
        .toArray();
      return sendResponse(200, exams);
    }

    // Route: GET /api/exams/{examId}
    if (method === 'GET' && path.match(/^\/api\/exams\/[a-zA-Z0-9_]+$/)) {
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

      // Check for existing attempts
      const existingAttempt = await db.collection('attempts').findOne({ userId, examId }, { sort: { startedAt: -1 } });
      if (existingAttempt) {
        if (existingAttempt.status === 'IN_PROGRESS') {
          // Resume existing attempt
          return sendResponse(200, { attemptId: existingAttempt._id, ...existingAttempt });
        } else {
          // Exam already completed. Attempt atomic consume of retake flag
          const userUpdate = await db.collection('users').findOneAndUpdate(
            { mobile: userId, allowedRetakes: examId },
            { $pull: { allowedRetakes: examId } },
            { returnDocument: 'after' }
          );
          
          if (!userUpdate) {
            return sendResponse(403, { error: 'You have already attempted this exam. Contact admin to retake.' });
          }
        }
      }

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
      const body = JSON.parse(event.body || '{}');

      const attempt = await db.collection('attempts').findOne({ _id: new ObjectId(attemptId) });
      if (!attempt) return sendResponse(404, { error: 'Attempt not found' });

      // If frontend sent finalResponses, merge them into attempt.responses
      if (body.finalResponses) {
        attempt.responses.forEach(r => {
          if (body.finalResponses[r.questionId]) {
            r.selectedAnswer = body.finalResponses[r.questionId].selectedAnswer;
            r.status = body.finalResponses[r.questionId].status;
          }
        });
      }

      const exam = await db.collection('exams').findOne({ examId: attempt.examId });

      let totalScore = 0;
      const sectionBreakdown = {};
      const detailedResponses = [];

      const questionMap = {};
      exam.sections.forEach(sec => {
        sectionBreakdown[sec.sectionId] = { attempted: 0, correct: 0, incorrect: 0, score: 0 };
        sec.questionGroups.forEach(group => {
          group.questions.forEach(q => {
            questionMap[q.questionId] = { ...q, sectionId: sec.sectionId };
          });
        });
      });

      attempt.responses.forEach(res => {
        const q = questionMap[res.questionId];
        if (!q) return;

        let marks = 0;
        let isCorrect = false;

        if (res.selectedAnswer) {
          sectionBreakdown[q.sectionId].attempted += 1;
          if (res.selectedAnswer === q.correctAnswer) {
            isCorrect = true;
            marks = q.positiveMarks;
            sectionBreakdown[q.sectionId].correct += 1;
          } else {
            marks = -(q.negativeMarks || 0);
            sectionBreakdown[q.sectionId].incorrect += 1;
          }
          sectionBreakdown[q.sectionId].score += marks;
          totalScore += marks;
        }

        detailedResponses.push({
          questionId: q.questionId,
          sectionId: q.sectionId,
          questionText: q.questionText,
          selectedAnswer: res.selectedAnswer,
          correctAnswer: q.correctAnswer,
          isCorrect,
          marksAwarded: marks
        });
      });

      const finalScores = { totalScore, sectionBreakdown, detailedResponses };

      await db.collection('attempts').updateOne(
        { _id: new ObjectId(attemptId) },
        { $set: { status: 'COMPLETED', submittedAt: new Date(), finalScores } }
      );

      return sendResponse(200, { success: true, finalScores });
    }

    // Fallback 404
    return sendResponse(404, { error: `Route ${method} ${path} not found` });

  } catch (error) {
    console.error('Lambda Error:', error);
    return sendResponse(500, { error: error.message });
  }
};