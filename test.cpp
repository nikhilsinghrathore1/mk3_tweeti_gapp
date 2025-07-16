#include <bits/stdc++.h>
using namespace std;

int lucky1(int arr[], int len)
{
               // ṣo the first approach it says that was to use to loops; 

               sort(arr , arr+len);
               int lucky = -1 ; 
               for (int i = 0 ; i< len ; i++){
                              int val = arr[i];
                              int freq= 1 ;  
                              while(i + freq < len && arr[i + freq] == val){
                                             freq++; 
                                             if(freq == arr[i]){
                                                            lucky = max(freq,lucky);
                                             }
                              }
               }
               return lucky;

}

int main()
{

               int arr[] = {2, 2, 3, 4};
               int len = sizeof(arr) / sizeof(int);
               cout<<lucky1(arr , len);
               return 0;
}