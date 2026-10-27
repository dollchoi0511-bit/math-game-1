// GitHub Pages용: 빌드나 서버 없이 Firebase CDN 모듈을 사용합니다.
const SDK = 'https://www.gstatic.com/firebasejs/13.1.0/';
const emit = (kind, detail) => window.dispatchEvent(new CustomEvent('mine-cloud-' + kind, { detail }));
const validRoom = room => /^[A-Za-z0-9_-]{2,24}$/.test(room);
let auth, db, fs, user, unsubscribe, roomRequested = '', watchToken = 0;
function describe(error) {
  const code = error?.code || '';
  if (code.includes('operation-not-allowed') || code.includes('admin-restricted-operation')) return 'Firebase Authentication에서 익명 로그인을 사용 설정해 주세요.';
  if (code.includes('permission-denied')) return 'Firestore 규칙에 FIRESTORE_ADD_RULES.txt의 광산 게임 규칙을 추가해 주세요.';
  if (code.includes('api-key') || code.includes('project-not-found')) return 'firebase-config.js의 웹 앱 설정을 확인해 주세요.';
  if (code.includes('unauthorized-domain')) return 'Firebase Authentication의 승인된 도메인에 GitHub Pages 도메인을 추가해 주세요.';
  if (code.includes('too-many-requests')) return '연결 요청이 많습니다. 잠시 뒤 다시 연결해 주세요.';
  return '공유 순위에 연결하지 못했어요. 인터넷과 Firebase 설정을 확인하고 다시 연결해 주세요.';
}
const ready = (async () => {
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')
    ]);
    const app = appSdk.initializeApp(window.MINE_FIREBASE_CONFIG, 'pythagoras-mine');
    auth = authSdk.getAuth(app); fs = firestoreSdk; db = fs.getFirestore(app);
    await auth.authStateReady();
    user = auth.currentUser || (await authSdk.signInAnonymously(auth)).user;
    emit('status', { state: 'ready', message: 'Firebase 연결 준비 완료 · 반 코드를 입력하세요.' });
    return true;
  } catch (error) {
    emit('status', { state: 'error', message: describe(error) });
    return false;
  }
})();
async function subscribe(room) {
  const token = ++watchToken; roomRequested = room;
  unsubscribe?.(); unsubscribe = null;
  emit('rows', { room, rows: [], source: 'loading' });
  if (!validRoom(room)) {
    emit('status', { state: 'idle', message: '같은 반은 같은 반 코드를 입력해 주세요. 예: 2-1' });
    return;
  }
  emit('status', { state: 'connecting', message: room + '반 공유 순위 연결 중…' });
  if (!await ready || token !== watchToken) return;
  const query = fs.query(fs.collection(db, 'pythagorasClasses', room, 'scores'), fs.orderBy('rankScore', 'desc'), fs.limit(200));
  unsubscribe = fs.onSnapshot(query, { includeMetadataChanges: true }, snapshot => {
    if (token !== watchToken) return;
    const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    emit('rows', { room, rows, source: snapshot.metadata.fromCache ? 'cache' : 'server' });
    emit('status', { state: snapshot.metadata.fromCache ? 'connecting' : 'connected', message: snapshot.metadata.fromCache ? room + '반 서버 동기화 중…' : room + '반 실시간 명예의 전당 연결됨' });
  }, error => emit('status', { state: 'error', message: describe(error) }));
}
async function save(record) {
  if (!validRoom(record.classCode) || !/^\d{3,6}$/.test(record.studentNumber) || !/^[가-힣A-Za-z· ]{2,20}$/.test(record.studentName)) throw new Error('학번과 이름을 다시 확인해 주세요.');
  if (!await ready) throw new Error('공유 저장 연결이 준비되지 않았습니다. 새로고침 후 다시 시도해 주세요.');
  const ref = fs.doc(db, 'pythagorasClasses', record.classCode, 'scores', user.uid + '_' + record.studentNumber);
  const rankScore = record.level * 10000000 + record.passed * 100000 + 86400 - record.time;
  let improved = false;
  try {
    await fs.runTransaction(db, async transaction => {
      const previous = await transaction.get(ref);
      if (previous.exists() && previous.data().rankScore >= rankScore) return;
      improved = true;
      transaction.set(ref, {
        ownerUid: user.uid, classCode: record.classCode, studentNumber: record.studentNumber,
        studentName: record.studentName, level: record.level, passed: record.passed, time: record.time,
        win: record.win, rankScore, updatedAt: fs.serverTimestamp()
      });
    });
    return { improved };
  } catch (error) { throw new Error(describe(error)); }
}
window.mineCloud = { subscribe, save, ready, reconnect: () => subscribe(roomRequested) };
emit('available', {});
