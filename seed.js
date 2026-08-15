require('dotenv').config();
const { MongoClient } = require('mongodb');

const MOCK_EXAM = {
  examId: 'CAT2026_MOCK_1',
  title: 'CAT 2026 Mock Test 1',
  sections: [
    {
      sectionId: 'VARC',
      title: 'Verbal Ability and Reading Comprehension',
      durationSeconds: 2400,
      questionGroups: [
        {
          sharedContext: '<p>Read the following passage carefully and answer the questions that follow...</p><p>Artificial intelligence is transforming the way we work, live, and interact with the world...</p>',
          questions: [
            {
              questionId: 'q1',
              questionNumber: 1,
              type: 'MCQ',
              positiveMarks: 3,
              negativeMarks: 1,
              questionText: '<p>What is the primary theme of the passage?</p>',
              options: [
                { id: 'A', text: 'The history of computing.' },
                { id: 'B', text: 'The impact of AI on society.' },
                { id: 'C', text: 'How to build neural networks.' },
                { id: 'D', text: 'The economic cost of automation.' }
              ],
              correctAnswer: 'B'
            },
            {
              questionId: 'q2',
              questionNumber: 2,
              type: 'TITA',
              positiveMarks: 3,
              negativeMarks: 0,
              questionText: '<p>Type the 4-letter acronym for Artificial Intelligence.</p>',
              correctAnswer: 'AI'
            }
          ]
        }
      ]
    },
    {
      sectionId: 'DILR',
      title: 'Data Interpretation and Logical Reasoning',
      durationSeconds: 2400,
      questionGroups: [
        {
          sharedContext: '<p>A school has 5 teachers: A, B, C, D, and E. They teach 5 different subjects...</p>',
          questions: [
            {
              questionId: 'q3',
              questionNumber: 3,
              type: 'MCQ',
              positiveMarks: 3,
              negativeMarks: 1,
              questionText: '<p>Who teaches Mathematics?</p>',
              options: [
                { id: 'A', text: 'Teacher A' },
                { id: 'B', text: 'Teacher B' },
                { id: 'C', text: 'Teacher C' },
                { id: 'D', text: 'Teacher D' }
              ],
              correctAnswer: 'C'
            }
          ]
        }
      ]
    },
    {
      sectionId: 'QA',
      title: 'Quantitative Aptitude',
      durationSeconds: 2400,
      questionGroups: [
        {
          sharedContext: null,
          questions: [
            {
              questionId: 'q4',
              questionNumber: 4,
              type: 'TITA',
              positiveMarks: 3,
              negativeMarks: 0,
              questionText: '<p>What is 15% of 200?</p>',
              correctAnswer: '30'
            }
          ]
        }
      ]
    }
  ]
};

async function seedDB() {
  console.log('Connecting to MongoDB Atlas...');
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    const db = client.db('cat_prep_db');

    console.log('Clearing old exams...');
    await db.collection('exams').deleteMany({});

    console.log('Inserting mock exam data...');
    await db.collection('exams').insertOne(MOCK_EXAM);

    console.log('Clearing old users...');
    await db.collection('users').deleteMany({});

    console.log('Inserting initial users...');
    await db.collection('users').insertMany([
      {
        mobile: '8000000000',
        password: 'adminpass',
        name: 'Administrator',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        mobile: '9132435465',
        password: '1234',
        name: 'Maitreyee',
        role: 'basic_user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ]);

    console.log('Successfully seeded database with exams and users!');
  } catch (err) {
    console.error('Error seeding DB:', err);
  } finally {
    await client.close();
  }
}

seedDB();
