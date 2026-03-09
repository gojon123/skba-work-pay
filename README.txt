SKBA Work Pay - 정적 배포형

포함 기능
- 공지 기능 삭제 반영
- 근무 캘린더
- 급여 계산기
- 현장 채팅
- 인수인계
- 인원 현황
- 작업 보고서 카카오톡 복사용
- 설정

배포 방법
1) 폴더째 Vercel에 업로드
2) Framework Preset: Other
3) Build Command 비워두기
4) Output Directory 비워두기

Firebase 실시간 공유 사용 방법
1) firebase-config.js 열기
2) Firebase 웹앱 설정값 입력
3) Firestore Database 생성
4) 아래 테스트 규칙 적용

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId}/{document=**} {
      allow read, write: if true;
    }
  }
}

참고
- firebase-config.js 값을 비워두면 로컬 단독 모드로 동작합니다.
- 급여 계산 데이터는 개인용이라 로컬 저장입니다.
