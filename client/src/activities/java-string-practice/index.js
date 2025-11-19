import JavaStringPracticeManager from './manager/JavaStringPracticeManager';
import JavaStringPractice from './student/JavaStringPractice';

export const javaStringPracticeActivity = {
  id: 'java-string-practice',
  name: 'Java String Practice',
  description: 'Interactive practice for Java String methods',
  ManagerComponent: JavaStringPracticeManager,
  StudentComponent: JavaStringPractice,
  footerContent: null,
  buttonColor: 'indigo',
};

export default javaStringPracticeActivity;
