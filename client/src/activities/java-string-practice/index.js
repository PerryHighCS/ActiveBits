import JavaStringPracticeManager from './manager/JavaStringPracticeManager';
import JavaStringPractice from './student/JavaStringPractice';

export const javaStringPracticeActivity = {
  id: 'java-string-practice',
  name: 'Java String Practice',
  description: 'Interactive practice for Java String methods',
  ManagerComponent: JavaStringPracticeManager,
  StudentComponent: JavaStringPractice,
  footerContent: null,
  color: 'indigo',
  
  // Whether this activity can be used in solo mode (without a teacher session)
  soloMode: true,
};

export default javaStringPracticeActivity;
