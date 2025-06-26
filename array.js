const arr = [1,2,-3,4,5,6,7,9]; 
let k = 10; 
const flag = false ; 
let num1 , num2 
// logic


arr.forEach((e,i)=>{
               num1 = arr[i]
               num2 = arr[arr.length() -1 ]

               if(num1 > num2){
                              let num3 = num2 
                              num2 = num1  
                              num1 = num3 
               }

                              
})