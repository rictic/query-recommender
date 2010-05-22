#! /bin/sh
ARGS=$*
rm -f error.log
ps aux | grep node | grep -v grep
if [ $? -eq -0 ]; then
  echo 'Node already running!'
  exit 1
fi
nohup node server.js $ARGS >> error.log &
tail -f error.log

