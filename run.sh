#! /bin/sh
ARGS=$*
LOG=logs/error.log
PID=`ps -Ao pid,command | grep node | grep -v grep | cut -c1-6`
if [ -n "$PID" ]; then
  echo
  echo "Node already running on --- $HOSTNAME ----"
  ps -A | grep node | grep -v grep
  echo
  echo "Press return to kill node"
  read dummy
  /bin/kill $PID
  if [ "$?" -ne "0" ]; then
    echo 'Failed to kill node. Stopping'
    echo "try:"
    echo "sudo kill $PID"
    exit 1
  fi
  echo "Waiting for node to die"
  sleep 2
fi
echo
echo "Starting node"
if [ -f $LOG ]; then
  mv $LOG logs/error-`date +%s`.log
fi
nohup node server.js $ARGS > $LOG &
sleep 1
cat $LOG
echo 
echo "try running"
echo "    tail -F $LOG"

