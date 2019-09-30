'use strict';

const getProfileName = () => {
  if (process.env.LAMBDA_TASK_ROOT && process.env.AWS_EXECUTION_ENV) return '';

  let profile = 'default';
  const profileIndex = process.argv.indexOf('--profile');
  if (profileIndex > 0 && profileIndex + 1 < process.argv.length) {
    profile = process.argv[profileIndex + 1];
  }
  return profile;
};

module.exports = getProfileName;
