#! /bin/sh
ARGS=$*
PID=`ps -eo pid,args | grep node | grep -v grep | cut -c1-6`
if [ -n "$PID" ]; then
  echo
  echo 'Node already running! Press return to kill'
  ps -e | grep node | grep -v grep
  read dummy
  /bin/kill $PID
  if [ "$?" -ne "0" ]; then
    echo 'Failed to kill node. Stopping'
    exit 1
  fi
  echo "Waiting for node to die"
  sleep 2
fi
echo
echo "Starting node"
rm -f error.log
nohup node server.js $ARGS > error.log &
echo 
echo "try running"
echo "    tail -F error.log"

