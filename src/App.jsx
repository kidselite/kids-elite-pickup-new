import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  addDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  serverTimestamp 
} from 'firebase/firestore';

// Tailwind Colors for Kids Elite (Cheerful and Vibrant)
const COLORS = {
  primary: 'violet-500',
  secondary: 'fuchsia-500',
  accent: 'emerald-400',
  bg: 'gray-50',
  teacher: 'blue-600',
  parent: 'purple-600',
};

// Global Firebase setup variables (provided by Canvas environment)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Hardcoded Teacher Access Code (as requested: 1429)
const TEACHER_ACCESS_CODE = '1429';

// Status Definitions for Parent Submission
const PICKUP_STATUSES = [
  { value: 'ARRIVED', label: '🚗 I have arrived (in the car)', color: 'bg-green-500' },
  { value: '5_MINS', label: '🕒 Arriving in 5-10 minutes', color: 'bg-yellow-500' },
  { value: 'READY', label: '✅ Student is ready to come out!', color: 'bg-blue-500' },
  { value: 'ABSENT', label: '🚫 Absent today/Activity cancelled', color: 'bg-gray-500' },
  { value: 'PARK_TEACHER', label: '🌳 Park Pickup - Please bring student out', color: 'bg-orange-500' },
  { value: 'PARK_PARENT', label: '🌳 Park Pickup - Parent will pick up at park', color: 'bg-orange-600' },
  { value: 'MESSAGE', label: '💬 Message only for teacher', color: 'bg-fuchsia-500' },
];

// Status Definitions for Teacher Processing
const TEACHER_STATUSES = {
  PENDING: { label: 'Pending', color: 'bg-red-500' },
  SEEN: { label: 'Seen', color: 'bg-yellow-500' },
  PROCESSING: { label: 'Processing', color: 'bg-blue-500' },
  READY: { label: 'Ready', color: 'bg-accent' },
  DELIVERED: { label: 'Delivered', color: 'bg-gray-500' },
};

let app, db, auth;

// --- Firebase Initialization and Auth Hook ---
const useFirebase = () => {
  const [dbInstance, setDbInstance] = useState(null);
  const [authInstance, setAuthInstance] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    if (firebaseConfig) {
      try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Log for debugging
        // setLogLevel('Debug');
        
        setDbInstance(db);
        setAuthInstance(auth);

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (user) {
            setUserId(user.uid);
          } else {
            // Sign in anonymously if no user is signed in
            try {
              await signInAnonymously(auth);
              console.log('Signed in anonymously.');
            } catch (error) {
              console.error('Anonymous sign in failed:', error);
            }
          }
          setIsAuthReady(true);
        });

        const trySignIn = async () => {
          if (initialAuthToken) {
            try {
              await signInWithCustomToken(auth, initialAuthToken);
              console.log('Signed in with custom token.');
            } catch (error) {
              console.error('Custom token sign in failed:', error);
            }
          }
        };

        trySignIn();
        return () => unsubscribe();
      } catch (error) {
        console.error("Firebase initialization error:", error);
      }
    }
  }, []);

  return { db: dbInstance, auth: authInstance, userId, isAuthReady };
};

// --- Custom Hook for UUID Generation ---
const useUUID = () => {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID : () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
};

// --- Components ---

// Utility for formatting timestamps
const formatTime = (timestamp) => {
  if (!timestamp) return 'N/A';
  // Firestore Timestamps need to be converted to JS Date
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

// --- 1. Teacher Dashboard Components ---

const TeacherActions = ({ pickup, db, auth, onUpdate, isSending }) => {
  const [isReady, setIsReady] = useState(false);
  const [isSpeechAvailable] = useState('webkitSpeechRecognition' in window);
  const [isListening, setIsListening] = useState(false);
  const [speechText, setSpeechText] = useState('');
  const [tempSpeechText, setTempSpeechText] = useState('');

  // Update status (Seen, Processing, Delivered)
  const updateStatus = async (newStatus) => {
    if (!db || !auth.currentUser) return;
    const pickupDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'pickups', pickup.id);
    await onUpdate(pickup.id, {
      teacherStatus: newStatus,
      teacherId: auth.currentUser.uid,
      teacherName: auth.currentUser.email || 'Teacher',
      lastUpdateAt: serverTimestamp(),
    });
  };

  // Student Ready (READY)
  const setStudentReady = async () => {
    if (!db || !auth.currentUser) return;
    const pickupDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'pickups', pickup.id);
    await onUpdate(pickup.id, {
      teacherStatus: 'READY',
      teacherId: auth.currentUser.uid,
      teacherName: auth.currentUser.email || 'Teacher',
      lastUpdateAt: serverTimestamp(),
      studentReadyAt: serverTimestamp(), // Record timestamp for parent display
    });
    setIsReady(true);
  };

  // Send Voice/Text Message to Parent
  const sendTeacherMessage = async () => {
    if (!db || !auth.currentUser || !speechText.trim()) return;
    const pickupDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'pickups', pickup.id);
    await onUpdate(pickup.id, {
      teacherMessage: speechText.trim(),
      teacherStatus: 'PROCESSING', // Change status to show active communication
      lastUpdateAt: serverTimestamp(),
    });
    setSpeechText(''); // Clear local state after sending
  };

  // Web Speech API Logic
  const startListening = () => {
    if (!isSpeechAvailable) {
      alert("Your browser does not support voice input. Please type manually.");
      return;
    }
    
    // Check if the permission is available
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(() => {
                const recognition = new window.webkitSpeechRecognition();
                recognition.lang = 'en-US'; // Use English
                recognition.interimResults = false;
                recognition.maxAlternatives = 1;
        
                recognition.onstart = () => setIsListening(true);
                recognition.onend = () => setIsListening(false);
        
                recognition.onresult = (event) => {
                  const transcript = event.results[0][0].transcript;
                  setTempSpeechText(transcript);
                  setSpeechText(transcript); // Set final text
                };
        
                recognition.onerror = (event) => {
                  console.error('Speech recognition error:', event.error);
                  setIsListening(false);
                  setTempSpeechText('Voice input failed, please try again.');
                };
        
                recognition.start();
            })
            .catch(err => {
                alert("Cannot access microphone. Please check your browser permissions.");
            });
    } else {
        alert("Cannot access microphone. Your browser might not support this feature.");
    }

  };

  return (
    <div className="flex flex-col space-y-2 pt-2 border-t border-gray-100 mt-2">
      {/* Status Tags Area */}
      <div className="grid grid-cols-4 gap-2">
        <ActionButton onClick={() => updateStatus('SEEN')} status="SEEN" currentStatus={pickup.teacherStatus} color="bg-yellow-500">
          👀 Seen
        </ActionButton>
        <ActionButton onClick={() => updateStatus('PROCESSING')} status="PROCESSING" currentStatus={pickup.teacherStatus} color="bg-blue-500">
          ⚙️ Processing
        </ActionButton>
        <ActionButton onClick={setStudentReady} status="READY" currentStatus={pickup.teacherStatus} color="bg-accent">
          🎒 Student Ready
        </ActionButton>
        <ActionButton onClick={() => updateStatus('DELIVERED')} status="DELIVERED" currentStatus={pickup.teacherStatus} color="bg-gray-500">
          ✅ Completed
        </ActionButton>
      </div>

      {/* Voice/Message Reply Area */}
      <div className="flex space-x-2">
        <input
          type="text"
          value={speechText}
          onChange={(e) => setSpeechText(e.target.value)}
          placeholder={isListening ? '🎤 Listening...' : 'Enter message for parent...'}
          className={`flex-grow p-2 rounded-lg border ${pickup.teacherStatus === 'READY' ? 'border-accent' : 'border-gray-300'} focus:ring-2 focus:ring-${COLORS.primary}`}
          disabled={isListening}
        />
        {isSpeechAvailable && (
          <button
            onClick={startListening}
            className={`p-2 rounded-lg transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-200 hover:bg-gray-300'}`}
            title="Voice Input"
            disabled={isSending}
          >
            {isListening ? '🛑' : '🎙️'}
          </button>
        )}
        <button
          onClick={sendTeacherMessage}
          disabled={!speechText.trim() || isSending}
          className={`px-4 py-2 rounded-lg bg-${COLORS.teacher} text-white font-bold shadow-md transition-all hover:bg-blue-700 disabled:opacity-50`}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
      {tempSpeechText && tempSpeechText !== speechText && <p className="text-sm text-red-500">Voice Draft: {tempSpeechText}</p>}
    </div>
  );
};

const ActionButton = ({ onClick, status, currentStatus, color, children }) => {
  const isActive = currentStatus === status;
  return (
    <button
      onClick={onClick}
      className={`px-2 py-2 text-sm rounded-lg shadow-sm font-bold transition-all ${isActive ? `${color} text-white scale-105 shadow-md` : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
    >
      {children}
    </button>
  );
};

const NotificationCard = ({ pickup, db, auth, onUpdate, isSending }) => {
  const statusDef = PICKUP_STATUSES.find(s => s.value === pickup.status) || { label: pickup.status, color: 'bg-gray-400' };
  const teacherStatusDef = TEACHER_STATUSES[pickup.teacherStatus] || TEACHER_STATUSES.PENDING;

  return (
    <div 
      className={`p-4 mb-4 rounded-xl shadow-lg border-l-4 ${teacherStatusDef.color} transition-all duration-300 ease-in-out bg-white ${pickup.teacherStatus === 'DELIVERED' ? 'opacity-60 grayscale' : ''}`}
    >
      {/* Header & Status */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="text-xl font-extrabold text-gray-800">
            {pickup.parentName}
            <span className="text-sm font-medium text-gray-500 ml-2">({pickup.parentSessionId.substring(0, 8)})</span>
          </h3>
          <p className="text-sm text-gray-600">Student(s): <span className="font-semibold text-lg text-primary">{pickup.studentNames}</span></p>
        </div>
        <div className={`px-3 py-1 text-sm font-bold text-white rounded-full ${teacherStatusDef.color} shadow-md`}>
          {teacherStatusDef.label}
        </div>
      </div>

      {/* Main Message */}
      <div className={`p-3 rounded-lg text-white font-medium ${statusDef.color} mb-2 shadow-inner`}>
        <span className="text-lg">🛎️ {statusDef.label}</span>
        {pickup.eta && pickup.status !== 'MESSAGE' && <span className="ml-2 font-bold">({pickup.eta})</span>}
      </div>

      {/* Details */}
      <div className="text-sm text-gray-700 space-y-1">
        <p><strong>Submitted Time:</strong> {formatTime(pickup.createdAt)}</p>
        {pickup.pickupHelper && <p className="text-red-600 font-bold">📢 Helper/Proxy: {pickup.pickupHelper}</p>}
        {pickup.message && <p>💬 Parent Note: {pickup.message}</p>}
        {pickup.teacherMessage && <p className={`p-1 mt-1 rounded text-base font-semibold bg-blue-100 border-l-4 border-${COLORS.teacher}`}>
            📣 Teacher Reply: {pickup.teacherMessage}
          </p>}
      </div>

      {/* Actions */}
      <TeacherActions pickup={pickup} db={db} auth={auth} onUpdate={onUpdate} isSending={isSending} />
    </div>
  );
};

const TeacherDashboard = ({ db, auth, onLogout, isSending, onUpdate }) => {
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);

  // Real-time listener for all public pickup notifications
  useEffect(() => {
    if (!db) return;
    setLoading(true);

    const q = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'pickups'),
      // Sort in memory to avoid indexing issues and allow complex sorting
      // where('createdAt', 'desc') // Removed due to index requirement
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allPickups = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date(), // Convert Firestore Timestamp
      }));
      
      // Sort in memory: PENDING/PROCESSING/READY first, then by time. DELIVERED last.
      allPickups.sort((a, b) => {
        const order = { PENDING: 0, PROCESSING: 1, READY: 2, SEEN: 3, DELIVERED: 4 };
        const aOrder = order[a.teacherStatus] || 0;
        const bOrder = order[b.teacherStatus] || 0;
        
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        // If same status, sort by creation time (newest first)
        return b.createdAt.getTime() - a.createdAt.getTime(); 
      });

      setPickups(allPickups);
      setLoading(false);
    }, (error) => {
      console.error("Error listening to pickups:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db]);

  const activePickups = pickups.filter(p => p.teacherStatus !== 'DELIVERED');
  const completedPickups = pickups.filter(p => p.teacherStatus === 'DELIVERED');

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className={`flex justify-between items-center p-4 mb-6 rounded-xl shadow-lg bg-${COLORS.teacher} text-white bg-gradient-to-r from-blue-700 to-cyan-500`}>
          <h1 className="text-2xl md:text-3xl font-black tracking-wider">
            Kids Elite Teacher Pickup Dashboard
          </h1>
          <button 
            onClick={onLogout}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-red-500 hover:bg-red-600 transition-all shadow-md"
          >
            Logout
          </button>
        </header>

        {/* User ID for debugging/sharing */}
        <div className="mb-4 p-2 bg-white rounded-lg shadow-inner text-xs text-gray-500 break-words">
          Teacher UID: {auth?.currentUser?.uid || 'Loading...'}
        </div>

        {/* Notifications List */}
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b pb-2">Live Notifications Today ({activePickups.length})</h2>
        {loading && <p className="text-center py-8 text-xl text-gray-500">🚀 Loading data...</p>}

        <div className="grid grid-cols-1 gap-4">
          {activePickups.map(pickup => (
            <NotificationCard 
              key={pickup.id} 
              pickup={pickup} 
              db={db} 
              auth={auth} 
              onUpdate={onUpdate}
              isSending={isSending}
            />
          ))}
        </div>
        
        {activePickups.length === 0 && !loading && (
          <div className="text-center py-12 rounded-xl border-4 border-dashed border-accent text-gray-500">
            <p className="text-2xl font-bold">🎉 Great! No pending pickup notifications.</p>
            <p className="text-lg mt-2">Check the completed records below.</p>
          </div>
        )}

        {/* Completed List */}
        <h2 className="text-xl font-bold mt-8 mb-4 text-gray-700 border-b pb-2">Completed Pickup Records ({completedPickups.length})</h2>
        <div className="grid grid-cols-1 gap-4">
          {completedPickups.slice(0, 5).map(pickup => (
            <NotificationCard 
              key={pickup.id} 
              pickup={pickup} 
              db={db} 
              auth={auth} 
              onUpdate={onUpdate}
              isSending={isSending}
            />
          ))}
          {completedPickups.length > 5 && <p className="text-center text-gray-500">...and {completedPickups.length - 5} more completed records</p>}
        </div>

      </div>
    </div>
  );
};

// --- 2. Parent View Components ---

const ParentForm = ({ db, userId, onSubmissionSuccess }) => {
  const [parentName, setParentName] = useState('');
  const [studentNames, setStudentNames] = useState('');
  const [pickupStatus, setPickupStatus] = useState(PICKUP_STATUSES[0].value);
  const [eta, setEta] = useState('5-10 minutes'); // Used for ARRIVED/5_MINS
  const [pickupHelper, setPickupHelper] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const generateUUID = useUUID();

  const isParkStatus = pickupStatus.includes('PARK');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!db || isSubmitting || !parentName.trim() || !studentNames.trim()) return;

    setIsSubmitting(true);
    const newSessionId = generateUUID();
    
    // Create new document in the public collection
    const pickupsCollectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'pickups');
    
    try {
      const docRef = await addDoc(pickupsCollectionRef, {
        parentName: parentName.trim(),
        studentNames: studentNames.trim(),
        status: pickupStatus,
        eta: pickupStatus === 'ARRIVED' ? 'Arrived' : (pickupStatus === '5_MINS' ? eta : ''),
        pickupHelper: pickupHelper.trim(),
        message: message.trim(),
        parentSessionId: newSessionId,
        teacherStatus: 'PENDING', // Initial status
        createdAt: serverTimestamp(),
        lastUpdateAt: serverTimestamp(),
      });
      
      // Pass the session ID and document ID back to the main App component
      onSubmissionSuccess(newSessionId, docRef.id);
    } catch (error) {
      console.error("Error submitting pickup request:", error);
      alert("Submission failed. Please check your connection or try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusColor = () => {
    const status = PICKUP_STATUSES.find(s => s.value === pickupStatus);
    return status ? status.color.replace('bg-', 'text-') : 'text-gray-700';
  };

  return (
    <div className="max-w-lg mx-auto p-4 md:p-8 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] bg-white transform transition duration-500 hover:shadow-[0_25px_60px_rgba(100,0,255,0.2)]">
      <h2 className="text-3xl font-extrabold mb-6 text-center text-primary bg-clip-text text-transparent bg-gradient-to-r from-violet-600 to-fuchsia-600">
        Kids Elite Pickup Notification
      </h2>
      <p className="text-center mb-6 text-gray-600">Please let us know your pickup status on the way or upon arrival to minimize waiting time.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name Inputs */}
        <div className="space-y-4 p-4 rounded-xl bg-gray-50 border border-gray-200">
          <label className="block">
            <span className="text-lg font-bold text-gray-800 flex items-center mb-1">
              👤 Parent/Pickup Person Name <span className="text-red-500">*</span>
            </span>
            <input
              type="text"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              placeholder="Your full name"
              required
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400 transition"
            />
          </label>
          <label className="block">
            <span className="text-lg font-bold text-gray-800 flex items-center mb-1">
              👶 Student(s) Name (Multiple allowed) <span className="text-red-500">*</span>
            </span>
            <input
              type="text"
              value={studentNames}
              onChange={(e) => setStudentNames(e.target.value)}
              placeholder="Jason, Amy (separate by comma)"
              required
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400 transition"
            />
          </label>
          <label className="block">
            <span className="text-lg font-bold text-gray-800 flex items-center mb-1">
              🤝 Helper/Proxy Name (if applicable)
            </span>
            <input
              type="text"
              value={pickupHelper}
              onChange={(e) => setPickupHelper(e.target.value)}
              placeholder="Name of the person picking up the student(s)"
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400 transition"
            />
          </label>
        </div>

        {/* Status Selection */}
        <div className="space-y-3 p-4 rounded-xl bg-violet-50/50 border border-violet-200">
          <p className="text-xl font-bold text-violet-800 flex items-center">
            🚀 Select Your Pickup Status
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PICKUP_STATUSES.filter(s => s.value !== 'READY').map(status => (
              <button
                key={status.value}
                type="button"
                onClick={() => {
                  setPickupStatus(status.value);
                  if (status.value === 'MESSAGE') setEta('');
                }}
                className={`p-3 rounded-xl text-white font-semibold transition-all shadow-md transform hover:scale-[1.02] active:scale-95 ${status.color} ${pickupStatus === status.value ? 'ring-4 ring-offset-2 ring-fuchsia-400' : 'opacity-80'}`}
              >
                {status.label}
              </button>
            ))}
          </div>

          {/* ETA / Option for Park */}
          {(pickupStatus === '5_MINS' || isParkStatus) && (
            <div className="mt-4 p-3 rounded-lg bg-white border border-dashed border-accent shadow-inner">
              <label className="block">
                <span className="text-base font-semibold text-gray-700">
                  {pickupStatus === '5_MINS' ? 'Estimated time of arrival?' : isParkStatus ? 'Park Pickup Details' : ''}
                </span>
                {pickupStatus === '5_MINS' && (
                  <select
                    value={eta}
                    onChange={(e) => setEta(e.target.value)}
                    className="w-full mt-1 p-3 rounded-xl border border-gray-300"
                  >
                    <option value="5-10 minutes">5-10 minutes</option>
                    <option value="10-15 minutes">10-15 minutes</option>
                    <option value="15+ minutes">15+ minutes</option>
                  </select>
                )}
                {isParkStatus && (
                  <p className="mt-1 text-sm text-gray-600">
                    You selected Park Pickup ({pickupStatus === 'PARK_TEACHER' ? 'Teacher brings out' : 'Parent picks up at park'})
                  </p>
                )}
              </label>
            </div>
          )}
        </div>
        
        {/* Message Input (for all statuses) */}
        <label className="block">
          <span className="text-lg font-bold text-gray-800 flex items-center mb-1">
            📝 Note (Message for Teachers)
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows="3"
            placeholder="e.g., Please bring the water bottle, activity cancelled, etc."
            className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400 transition"
          />
        </label>


        {/* Submission Button */}
        <button
          type="submit"
          disabled={isSubmitting || !parentName.trim() || !studentNames.trim()}
          className={`w-full py-4 mt-6 rounded-2xl text-2xl font-black text-white shadow-xl transform transition-all ${isSubmitting ? 'bg-gray-400' : `bg-${COLORS.parent} hover:bg-violet-600 active:scale-[0.98] bg-gradient-to-r from-violet-500 to-fuchsia-500`}`}
        >
          {isSubmitting ? '🚀 Notifying Teachers...' : 'Notify Teachers Now'}
        </button>
        
        <p className={`text-center text-sm font-semibold mt-3 ${getStatusColor()}`}>
          Your selected status: {PICKUP_STATUSES.find(s => s.value === pickupStatus)?.label}
        </p>
      </form>
    </div>
  );
};

const ParentStatus = ({ db, pickupDocId, onReset }) => {
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Real-time listener for the parent's specific notification
  useEffect(() => {
    if (!db || !pickupDocId) return;
    setLoading(true);

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'pickups', pickupDocId);
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setStatusData({ id: docSnap.id, ...data });
        setLoading(false);
      } else {
        // If doc is deleted (e.g., archived/completed and deleted by admin)
        console.log("Your pickup status document was not found.");
        onReset(); // Reset the parent session
      }
    }, (error) => {
      console.error("Error listening to parent status:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, pickupDocId, onReset]);

  if (loading || !statusData) {
    return (
      <div className="max-w-lg mx-auto p-8 rounded-2xl shadow-xl bg-white text-center min-h-[300px] flex flex-col justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-fuchsia-500 mx-auto"></div>
        <p className="mt-4 text-xl font-bold text-fuchsia-600">Waiting for teacher reply and status sync...</p>
        <p className="text-sm text-gray-500 mt-2">Your notification has been successfully sent.</p>
      </div>
    );
  }

  const currentStatusDef = PICKUP_STATUSES.find(s => s.value === statusData.status);
  const teacherStatusDef = TEACHER_STATUSES[statusData.teacherStatus] || TEACHER_STATUSES.PENDING;
  
  const isReady = statusData.teacherStatus === 'READY';
  const isDelivered = statusData.teacherStatus === 'DELIVERED';

  return (
    <div className="max-w-lg mx-auto p-6 md:p-8 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] bg-white border-t-8 border-accent">
      <h2 className="text-3xl font-extrabold mb-4 text-center text-accent">
        ✅ Status Tracker ({statusData.studentNames})
      </h2>
      <p className="text-center mb-6 text-gray-600">
        Thank you! Your real-time notification status will be displayed here.
      </p>

      {/* Primary Status Card - Ready State */}
      <div className={`p-5 rounded-xl shadow-lg transform transition-all duration-500 ${isReady ? 'bg-gradient-to-r from-emerald-400 to-teal-500 text-white scale-[1.03] ring-4 ring-offset-2 ring-emerald-300' : 'bg-gray-50 border border-gray-200 text-gray-800'}`}>
        <div className="flex justify-between items-center">
          <p className="text-xl font-bold">
            {isReady ? '🎉 Student is Ready' : 'Current Processing Status'}
          </p>
          <div className={`px-3 py-1 text-sm font-bold rounded-full shadow-md ${teacherStatusDef.color} ${isReady ? 'text-white' : 'text-white'}`}>
            {isReady ? 'Proceed to Pickup Point' : teacherStatusDef.label}
          </div>
        </div>
        
        {isReady && (
          <p className="text-3xl font-black mt-2">
            Please proceed to the pickup point!
            <span className="block text-sm font-normal mt-1">
              (Ready Time: {statusData.studentReadyAt ? formatTime(statusData.studentReadyAt) : formatTime(new Date())})
            </span>
          </p>
        )}
      </div>
      
      {/* Teacher Message */}
      {statusData.teacherMessage && (
        <div className="mt-4 p-4 rounded-xl bg-blue-50 border-l-4 border-blue-600 shadow-md">
          <p className="font-bold text-blue-800 flex items-center">
            <span className="text-xl mr-2">📢</span> Teacher Reply ({statusData.teacherStatus === 'READY' ? 'Ready Status' : 'Message'}):
          </p>
          <p className="mt-1 text-lg text-blue-700 font-semibold">{statusData.teacherMessage}</p>
        </div>
      )}

      {/* Your Submission Details */}
      <div className="mt-6 space-y-3 text-gray-700 p-4 rounded-xl bg-gray-50 border">
        <p className="text-lg font-bold border-b pb-2 text-violet-700">Your Submission Details</p>
        <p><strong>Parent/Pickup Person:</strong> {statusData.parentName}</p>
        <p><strong>Student(s):</strong> <span className="font-bold text-xl text-fuchsia-600">{statusData.studentNames}</span></p>
        <p><strong>Notification Status:</strong> <span className={`font-semibold ${currentStatusDef.color.replace('bg-', 'text-')}`}>{currentStatusDef.label}</span></p>
        {(statusData.eta && statusData.status !== 'ARRIVED') && <p><strong>Estimated Arrival:</strong> {statusData.eta}</p>}
        {statusData.pickupHelper && <p className="text-red-500 font-bold">Helper/Proxy: {statusData.pickupHelper}</p>}
        {statusData.message && <p><strong>Note:</strong> {statusData.message}</p>}
        <p className="text-sm text-gray-500 mt-2">Submitted Time: {formatTime(statusData.createdAt)}</p>
      </div>

      {isDelivered && (
        <div className="mt-6 text-center p-4 bg-gray-200 rounded-xl">
          <p className="text-lg font-bold text-gray-700">🎉 Pickup task completed!</p>
          <button 
            onClick={onReset}
            className="mt-2 text-sm text-blue-500 hover:text-blue-700 underline"
          >
            Click here to submit a new pickup notification
          </button>
        </div>
      )}
    </div>
  );
};

// --- 3. Teacher Login Component ---

const TeacherLogin = ({ onLogin }) => {
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');
    if (accessCode === TEACHER_ACCESS_CODE) {
      if (onLogin(true)) {
        // Handled by parent component
      } else {
        setError('Login failed, please try again.');
      }
    } else {
      setError('Access Code incorrect. Please check.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="max-w-md w-full p-8 space-y-6 bg-white rounded-xl shadow-2xl border-t-8 border-blue-600">
        <h2 className="text-3xl font-extrabold text-center text-gray-900">
          Kids Elite Teacher Login
        </h2>
        <p className="text-center text-gray-600">Please enter the Teacher Access Code</p>
        <form onSubmit={handleLogin} className="mt-8 space-y-6">
          <input
            type="password"
            required
            className="w-full p-4 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-center text-xl tracking-widest"
            placeholder="****"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            maxLength={4}
          />
          {error && <p className="text-red-500 text-center font-medium">{error}</p>}
          <button
            type="submit"
            className={`w-full py-3 rounded-lg text-xl font-bold text-white bg-${COLORS.teacher} hover:bg-blue-700 transition-all shadow-lg transform hover:scale-[1.01]`}
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
};

// --- Main App Component ---

const App = () => {
  const { db, auth, userId, isAuthReady } = useFirebase();
  const [isTeacher, setIsTeacher] = useState(false);
  const [currentView, setCurrentView] = useState('Home'); // Home, Parent, Teacher
  const [pickupDocId, setPickupDocId] = useState(null); // Document ID for parent tracking
  const [isSending, setIsSending] = useState(false); // Global sending state for teacher actions

  const parentSessionIdKey = 'kidsElitePickupDocId';
  const teacherLoginKey = 'kidsEliteTeacher';

  // --- Initial Setup and Persistence ---
  useEffect(() => {
    // Check local storage for persistent teacher login
    const savedTeacher = localStorage.getItem(teacherLoginKey);
    if (savedTeacher === 'true') {
      setIsTeacher(true);
      setCurrentView('Teacher');
    } else {
      // Check local storage for parent session
      const savedDocId = localStorage.getItem(parentSessionIdKey);
      if (savedDocId) {
        setPickupDocId(savedDocId);
        setCurrentView('Parent');
      } else {
        setCurrentView('Parent'); // Default to Parent view if not logged in
      }
    }
  }, []);

  // --- Handlers ---
  const handleTeacherLogin = useCallback((success) => {
    if (success) {
      setIsTeacher(true);
      setCurrentView('Teacher');
      localStorage.setItem(teacherLoginKey, 'true');
      return true;
    }
    return false;
  }, []);

  const handleTeacherLogout = useCallback(async () => {
    // Note: We don't sign out of Firebase auth to keep the anonymous session or custom token
    // for seamless Firestore use, but we clear the local flag and app state.
    setIsTeacher(false);
    setCurrentView('Parent');
    localStorage.removeItem(teacherLoginKey);
    console.log('Teacher logged out.');
  }, []);

  const handleParentSubmission = useCallback((sessionId, docId) => {
    setPickupDocId(docId);
    localStorage.setItem(parentSessionIdKey, docId);
    setCurrentView('Parent'); // Switch to status view
  }, []);
  
  const handleParentReset = useCallback(() => {
    setPickupDocId(null);
    localStorage.removeItem(parentSessionIdKey);
    setCurrentView('Parent'); // Go back to form view
  }, []);

  // Universal Update Handler for Teacher Dashboard
  const handleNotificationUpdate = useCallback(async (docId, updateData) => {
    if (!db) return;
    setIsSending(true);
    try {
      const pickupDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'pickups', docId);
      await setDoc(pickupDocRef, updateData, { merge: true });
    } catch (error) {
      console.error("Failed to update notification:", error);
      alert("Failed to update notification status. Please check connection.");
    } finally {
      setIsSending(false);
    }
  }, [db]);


  // --- Routing ---
  const renderContent = () => {
    if (!isAuthReady || !db || !auth) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-xl font-bold text-gray-700">System Initializing...</p>
        </div>
      );
    }

    if (isTeacher && currentView === 'Teacher') {
      return (
        <TeacherDashboard 
          db={db} 
          auth={auth} 
          onLogout={handleTeacherLogout} 
          isSending={isSending}
          onUpdate={handleNotificationUpdate}
        />
      );
    }

    if (!isTeacher && currentView === 'TeacherLogin') {
      return <TeacherLogin onLogin={(success) => handleTeacherLogin(success)} />;
    }

    // Default to Parent View or Parent Status View
    if (pickupDocId) {
      return <ParentStatus db={db} pickupDocId={pickupDocId} onReset={handleParentReset} />;
    } else {
      return <ParentForm db={db} userId={userId} onSubmissionSuccess={handleParentSubmission} />;
    }
  };

  const isParentView = !isTeacher && currentView !== 'TeacherLogin';

  return (
    <div className={`min-h-screen font-inter ${isParentView ? 'bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4' : 'bg-gray-50'}`}>
      {/* Fixed Footer for easy view switching */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white shadow-2xl border-t border-gray-200 z-10">
        <div className="flex justify-center items-center h-16 max-w-lg mx-auto">
          {isTeacher ? (
            <button 
              onClick={handleTeacherLogout}
              className="flex items-center space-x-2 text-sm text-red-600 p-2 rounded-full hover:bg-red-50 transition"
            >
              <span className="text-xl">🚪</span>
              <span className="font-bold">Teacher Logout</span>
            </button>
          ) : (
            <>
              <button 
                onClick={() => setCurrentView('Parent')}
                className={`flex-1 text-center py-2 transition-all border-b-4 ${currentView === 'Parent' ? 'border-fuchsia-500 text-fuchsia-600 font-bold' : 'border-transparent text-gray-500'}`}
              >
                Parent (Submit)
              </button>
              <button 
                onClick={() => setCurrentView('TeacherLogin')}
                className={`flex-1 text-center py-2 transition-all border-b-4 ${currentView === 'TeacherLogin' ? 'border-blue-600 text-blue-700 font-bold' : 'border-transparent text-gray-500'}`}
              >
                Teacher (Login)
              </button>
            </>
          )}
        </div>
      </footer>
      
      <div className="pb-20"> {/* Add padding for the fixed footer */}
        {renderContent()}
      </div>
    </div>
  );
};

export default App;