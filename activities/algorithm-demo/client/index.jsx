import DemoManager from './manager/DemoManager';
import DemoStudent from './student/DemoStudent';

export default {
  ManagerComponent: DemoManager,
  StudentComponent: DemoStudent,
  footerContent: (
    <>
      Algorithm Demonstrations with synchronized visualization. Instructors guide students through
      step-by-step execution of sorting, searching, and recursion algorithms. Solo mode available
      for independent practice.
    </>
  ),
};
